/**
 * Express Server with Simple Chat UI
 * Phase 1: Text-based conversation interface
 */

import express from 'express';
import dotenv from 'dotenv';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { ConversationEngine } from './engine/conversationEngine.js';
import { logger } from './utils/logger.js';
import { randomUUID } from 'crypto';
import { speechToText, textToSpeech } from './services/elevenLabsService.js';
import { storeSessionAudio, getSessionAudio, cleanupSessionAudio } from './services/audioSessionStorage.js';

dotenv.config();

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3000;
const BRAND_NAME = process.env.BRAND_NAME || 'Advisor Desk';
const SECURE_URL = process.env.SECURE_URL || 'https://advisors.example.com/complete';

// Initialize conversation engine
const conversationEngine = new ConversationEngine(BRAND_NAME, SECURE_URL);

// WebSocket server for voice streaming
const wss = new WebSocketServer({ server, path: '/ws/voice' });

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// API endpoint for chat
app.post('/api/chat', async (req, res) => {
  try {
    const { message, sessionId: providedSessionId } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Generate or use provided session ID
    const sessionId = providedSessionId || randomUUID();

    // Process input
    const result = await conversationEngine.processInput(sessionId, message);

    // Get recent logs for this session
    const sessionLogs = logger.getSessionLogs(sessionId).slice(-10); // Last 10 logs

    res.json({
      sessionId,
      response: result.response,
      state: result.state,
      intent: result.intent,
      slots: result.slots,
      toolCalls: result.toolCalls || [],
      logs: sessionLogs
    });
  } catch (error) {
    console.error('Chat API Error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
});

// API endpoint to get all logs
app.get('/api/logs', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const type = req.query.type || null;
  const sessionId = req.query.sessionId || null;
  
  let logs = logger.getLogs(limit);
  
  if (type) {
    logs = logs.filter(log => log.type === type);
  }
  
  if (sessionId) {
    logs = logs.filter(log => log.sessionId === sessionId);
  }
  
  res.json({ logs });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok'
  });
});

// WebSocket connection handler for voice streaming
wss.on('connection', (ws, req) => {
  const sessionId = randomUUID();
  let audioBuffer = Buffer.alloc(0);
  let isRecording = false;

  logger.log('system', 'WebSocket voice connection established', { sessionId });

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case 'start_recording':
          isRecording = true;
          audioBuffer = Buffer.alloc(0);
          ws.send(JSON.stringify({ type: 'recording_started', sessionId }));
          logger.log('system', 'Recording started', { sessionId });
          break;

        case 'audio_chunk':
          if (isRecording) {
            // Accumulate audio chunks (fallback for streaming chunks)
            const chunk = Buffer.from(message.data, 'base64');
            audioBuffer = Buffer.concat([audioBuffer, chunk]);
          }
          break;

        case 'audio_file':
          // Receive complete audio file from client
          // Accept audio file even if recording has stopped (might arrive slightly after stop_recording)
          const audioChunk = Buffer.from(message.data, 'base64');
          audioBuffer = Buffer.concat([audioBuffer, audioChunk]);
          logger.log('system', 'Received complete audio file', { 
            sessionId, 
            audioSize: audioChunk.length,
            totalSize: audioBuffer.length 
          });
          break;

        case 'stop_recording':
          isRecording = false;
          
          // Wait a moment for audio_file to arrive if it hasn't yet
          if (!audioBuffer || audioBuffer.length === 0) {
            logger.log('system', 'Waiting for audio file...', { sessionId });
            // Wait up to 1 second for audio file to arrive
            let waitCount = 0;
            const checkAudio = setInterval(() => {
              waitCount++;
              if (audioBuffer && audioBuffer.length > 0) {
                clearInterval(checkAudio);
                processAudioRecording();
              } else if (waitCount >= 10) { // 1 second timeout (10 * 100ms)
                clearInterval(checkAudio);
                logger.log('error', 'No audio data received after timeout', { sessionId });
                ws.send(JSON.stringify({
                  type: 'error',
                  message: 'No audio data received. Please try recording again.'
                }));
              }
            }, 100);
            break;
          }
          
          // Process audio if we already have it
          processAudioRecording();
          break;

        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;

        default:
          logger.log('system', 'Unknown WebSocket message type', { 
            sessionId, 
            type: message.type 
          });
      }
    } catch (error) {
      logger.log('error', 'WebSocket message error', { 
        sessionId, 
        error: error.message 
      });
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Failed to process message'
          }));
    }
  });

  // Helper function to process audio recording
  async function processAudioRecording() {
    // Validate audio buffer
    if (!audioBuffer || audioBuffer.length === 0) {
      logger.log('error', 'No audio data received', { sessionId });
      ws.send(JSON.stringify({
        type: 'error',
        message: 'No audio data received. Please try recording again.'
      }));
      return;
    }
    
    ws.send(JSON.stringify({ type: 'processing', step: 'saving_audio' }));
    logger.log('system', 'Recording stopped, saving audio to session', { 
      sessionId, 
      audioSize: audioBuffer.length 
    });

    try {
      // Step 1: Store audio in session memory and save to file
      const contentType = 'audio/webm'; // Default, can be passed in message if needed
      const audioFilePath = await storeSessionAudio(sessionId, audioBuffer, contentType);
      logger.log('system', 'Audio saved to session storage', { 
        sessionId, 
        filePath: audioFilePath,
        audioSize: audioBuffer.length 
      });

      // Step 2: Send audio file to Eleven Labs STT for transcription
      ws.send(JSON.stringify({ type: 'processing', step: 'transcribing' }));
      const transcript = await speechToText(audioBuffer, contentType);
      logger.log('system', 'STT transcript received', { sessionId, transcript });

      // Step 3: Display transcribed text in UI (send to client first)
      ws.send(JSON.stringify({ 
        type: 'transcript', 
        text: transcript 
      }));

      // Step 4: Process transcribed text through chatbot pipeline
      ws.send(JSON.stringify({ type: 'processing', step: 'processing_chatbot' }));
      const result = await conversationEngine.processInput(sessionId, transcript);
      logger.log('system', 'Conversation processed', { 
        sessionId, 
        response: result.response.substring(0, 100) 
      });

      // Step 5: Display text response first (text-first approach)
      ws.send(JSON.stringify({
        type: 'text_response',
        text: result.response,
        state: result.state,
        intent: result.intent,
        sessionId: sessionId
      }));

      // Step 6: Generate TTS audio from text response
      ws.send(JSON.stringify({ type: 'processing', step: 'generating_speech' }));
      const audioResponse = await textToSpeech(result.response);
      logger.log('system', 'TTS audio generated', { 
        sessionId, 
        audioSize: audioResponse.length 
      });

      // Step 7: Send audio response
      const audioBase64 = audioResponse.toString('base64');
      ws.send(JSON.stringify({
        type: 'audio_response',
        audio: audioBase64,
        text: result.response, // Include text again for reference
        state: result.state,
        intent: result.intent,
        sessionId: sessionId
      }));

      // Clear audio buffer for next recording
      audioBuffer = Buffer.alloc(0);

      // Optional: Clean up audio file after processing (or keep for debugging)
      // await cleanupSessionAudio(sessionId);

    } catch (error) {
      logger.log('error', 'Voice processing error', { 
        sessionId, 
        error: error.message 
      });
      ws.send(JSON.stringify({
        type: 'error',
        message: error.message
      }));
    }
  }

  ws.on('close', () => {
    logger.log('system', 'WebSocket voice connection closed', { sessionId });
  });

  ws.on('error', (error) => {
    logger.log('error', 'WebSocket error', { sessionId, error: error.message });
  });

  // Send welcome message
  ws.send(JSON.stringify({
    type: 'connected',
    sessionId,
    message: 'Voice connection established'
  }));
});

// Start server
server.listen(PORT, () => {
  console.log(`🚀 Voice Agent: Advisor Appointment Scheduler`);
  console.log(`🌐 Server running on http://localhost:${PORT}`);
  console.log(`💬 Chat UI available at http://localhost:${PORT}`);
  console.log(`🎙️  Voice UI available at http://localhost:${PORT}/voice.html`);
  console.log(`🔌 WebSocket available at ws://localhost:${PORT}/ws/voice`);
  console.log(`\n⚠️  Configuration:`);
  console.log(`   AI_PROVIDER=${process.env.AI_PROVIDER || 'groq'}`);
  console.log(`   ELEVEN_LABS_API_KEY=${process.env.ELEVEN_LABS_API_KEY ? '***configured***' : 'NOT SET'}`);
});

