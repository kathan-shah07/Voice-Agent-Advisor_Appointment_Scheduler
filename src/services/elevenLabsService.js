/**
 * Eleven Labs Service
 * Handles Speech-to-Text (STT) and Text-to-Speech (TTS) using Eleven Labs API
 */

import dotenv from 'dotenv';
import FormData from 'form-data';
import axios from 'axios';
import { logger } from '../utils/logger.js';

dotenv.config();

const ELEVEN_LABS_API_KEY = process.env.ELEVEN_LABS_API_KEY;
const ELEVEN_LABS_VOICE_ID = process.env.ELEVEN_LABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'; // Default voice: Rachel
const ELEVEN_LABS_STT_MODEL = process.env.ELEVEN_LABS_STT_MODEL || 'scribe_v1';
const ELEVEN_LABS_TTS_MODEL = process.env.ELEVEN_LABS_TTS_MODEL || 'eleven_multilingual_v2';

const ELEVEN_LABS_STT_URL = 'https://api.elevenlabs.io/v1/speech-to-text';
const ELEVEN_LABS_TTS_URL = `https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_LABS_VOICE_ID}`;

/**
 * Convert audio buffer to text using Eleven Labs STT
 * @param {Buffer} audioBuffer - Audio data buffer
 * @param {string} contentType - MIME type (e.g., 'audio/webm', 'audio/mpeg')
 * @returns {Promise<string>} - Transcribed text
 */
export async function speechToText(audioBuffer, contentType = 'audio/webm') {
  if (!ELEVEN_LABS_API_KEY) {
    throw new Error('ELEVEN_LABS_API_KEY is not configured');
  }

  try {
    // Validate audio buffer
    if (!audioBuffer || audioBuffer.length === 0) {
      throw new Error('Audio buffer is empty');
    }

    // Determine file extension based on content type
    let filename = 'audio.webm';
    if (contentType.includes('mpeg') || contentType.includes('mp3')) {
      filename = 'audio.mp3';
    } else if (contentType.includes('wav')) {
      filename = 'audio.wav';
    } else if (contentType.includes('ogg')) {
      filename = 'audio.ogg';
    }

    logger.log('system', 'Calling Eleven Labs STT API', { 
      audioSize: audioBuffer.length,
      contentType,
      filename
    });

    const formData = new FormData();
    formData.append('file', audioBuffer, {
      filename: filename,
      contentType: contentType,
    });
    formData.append('model_id', ELEVEN_LABS_STT_MODEL);

    const response = await axios.post(ELEVEN_LABS_STT_URL, formData, {
      headers: {
        'xi-api-key': ELEVEN_LABS_API_KEY,
        ...formData.getHeaders(),
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    // Handle different possible response formats
    let transcript = '';
    if (response.data) {
      // Try different possible field names
      transcript = response.data.text || 
                   response.data.transcript || 
                   response.data.transcription ||
                   (typeof response.data === 'string' ? response.data : '');
    }
    
    if (!transcript) {
      logger.log('error', 'Eleven Labs STT: No transcript in response', { 
        responseData: response.data 
      });
      throw new Error('No transcript received from Eleven Labs STT API');
    }
    
    logger.log('system', 'Eleven Labs STT success', { 
      transcript: transcript.substring(0, 100),
      transcriptLength: transcript.length
    });

    return transcript;
  } catch (error) {
    // Extract error message from various possible response formats
    let errorMessage = error.message;
    let statusCode = 'unknown';
    
    if (error.response) {
      statusCode = error.response.status;
      const responseData = error.response.data;
      
      // Handle different error response formats
      if (responseData?.detail) {
        if (typeof responseData.detail === 'string') {
          errorMessage = responseData.detail;
        } else if (responseData.detail?.message) {
          errorMessage = responseData.detail.message;
        } else if (responseData.detail?.status) {
          errorMessage = `${responseData.detail.status}: ${responseData.detail.message || 'Unknown error'}`;
        }
      } else if (responseData?.message) {
        errorMessage = responseData.message;
      } else if (typeof responseData === 'string') {
        errorMessage = responseData;
      }
    }
    
    logger.log('error', 'Eleven Labs STT error', { 
      status: statusCode,
      error: errorMessage,
      fullError: error.response?.data 
    });
    
    throw new Error(`Eleven Labs STT failed: ${statusCode} - ${errorMessage}`);
  }
}

/**
 * Convert text to speech audio using Eleven Labs TTS
 * @param {string} text - Text to convert to speech
 * @param {Object} options - TTS options
 * @returns {Promise<Buffer>} - Audio buffer
 */
export async function textToSpeech(text, options = {}) {
  if (!ELEVEN_LABS_API_KEY) {
    throw new Error('ELEVEN_LABS_API_KEY is not configured');
  }

  try {
    logger.log('system', 'Calling Eleven Labs TTS API', { 
      textLength: text.length,
      voiceId: ELEVEN_LABS_VOICE_ID 
    });

    const requestBody = {
      text: text,
      model_id: options.model || ELEVEN_LABS_TTS_MODEL,
      voice_settings: {
        stability: options.stability || 0.5,
        similarity_boost: options.similarity_boost || 0.75,
        style: options.style || 0.0,
        use_speaker_boost: options.use_speaker_boost !== false,
      },
    };

    const response = await fetch(ELEVEN_LABS_TTS_URL, {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVEN_LABS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.log('error', 'Eleven Labs TTS API error', { 
        status: response.status,
        error: errorText 
      });
      throw new Error(`Eleven Labs TTS failed: ${response.status} - ${errorText}`);
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    
    logger.log('system', 'Eleven Labs TTS success', { 
      audioSize: audioBuffer.length 
    });

    return audioBuffer;
  } catch (error) {
    logger.log('error', 'Eleven Labs TTS error', { 
      error: error.message 
    });
    throw error;
  }
}

/**
 * Stream text to speech using Eleven Labs streaming API
 * @param {string} text - Text to convert to speech
 * @param {Object} options - TTS options
 * @returns {Promise<ReadableStream>} - Audio stream
 */
export async function textToSpeechStream(text, options = {}) {
  if (!ELEVEN_LABS_API_KEY) {
    throw new Error('ELEVEN_LABS_API_KEY is not configured');
  }

  try {
    logger.log('system', 'Calling Eleven Labs TTS Stream API', { 
      textLength: text.length,
      voiceId: ELEVEN_LABS_VOICE_ID 
    });

    const requestBody = {
      text: text,
      model_id: options.model || ELEVEN_LABS_TTS_MODEL,
      voice_settings: {
        stability: options.stability || 0.5,
        similarity_boost: options.similarity_boost || 0.75,
        style: options.style || 0.0,
        use_speaker_boost: options.use_speaker_boost !== false,
      },
    };

    const response = await fetch(ELEVEN_LABS_TTS_URL + '/stream', {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVEN_LABS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.log('error', 'Eleven Labs TTS Stream API error', { 
        status: response.status,
        error: errorText 
      });
      throw new Error(`Eleven Labs TTS Stream failed: ${response.status} - ${errorText}`);
    }

    return response.body;
  } catch (error) {
    logger.log('error', 'Eleven Labs TTS Stream error', { 
      error: error.message 
    });
    throw error;
  }
}

