/**
 * Express Server with Simple Chat UI
 * Phase 1: Text-based conversation interface
 */

import express from 'express';
import dotenv from 'dotenv';
import { ConversationEngine } from './engine/conversationEngine.js';
import { logger } from './utils/logger.js';
import { randomUUID } from 'crypto';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const BRAND_NAME = process.env.BRAND_NAME || 'Advisor Desk';
const SECURE_URL = process.env.SECURE_URL || 'https://advisors.example.com/complete';

// Initialize conversation engine
const conversationEngine = new ConversationEngine(BRAND_NAME, SECURE_URL);

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
  res.json({ status: 'ok', phase: 'Phase 1: Core Conversation Engine' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Voice Agent: Advisor Appointment Scheduler`);
  console.log(` phase: Phase 1 - Core Conversation Engine`);
  console.log(`🌐 Server running on http://localhost:${PORT}`);
  console.log(`💬 Chat UI available at http://localhost:${PORT}`);
  console.log(`\n⚠️  Make sure to set your AI provider API key in .env file`);
  console.log(`   AI_PROVIDER=${process.env.AI_PROVIDER || 'groq'}`);
});

