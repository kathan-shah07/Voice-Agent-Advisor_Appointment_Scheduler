/**
 * Audio Session Storage Service
 * Manages storage of audio files in session memory and file system
 */

import { writeFile, unlink, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { logger } from '../utils/logger.js';

// Session storage: sessionId -> audio file info
const sessionAudioStorage = new Map();

// Audio storage directory
const AUDIO_STORAGE_DIR = join(process.cwd(), 'data', 'audio');

/**
 * Initialize audio storage directory
 */
async function ensureAudioStorageDir() {
  if (!existsSync(AUDIO_STORAGE_DIR)) {
    await mkdir(AUDIO_STORAGE_DIR, { recursive: true });
    logger.log('system', 'Created audio storage directory', { path: AUDIO_STORAGE_DIR });
  }
}

/**
 * Store audio buffer in session memory and save to file
 * @param {string} sessionId - Session ID
 * @param {Buffer} audioBuffer - Audio data buffer
 * @param {string} contentType - MIME type (e.g., 'audio/webm')
 * @returns {Promise<string>} - Path to saved audio file
 */
export async function storeSessionAudio(sessionId, audioBuffer, contentType = 'audio/webm') {
  try {
    await ensureAudioStorageDir();

    // Determine file extension
    let extension = 'webm';
    if (contentType.includes('mpeg') || contentType.includes('mp3')) {
      extension = 'mp3';
    } else if (contentType.includes('wav')) {
      extension = 'wav';
    } else if (contentType.includes('ogg')) {
      extension = 'ogg';
    }

    // Generate filename with timestamp
    const timestamp = Date.now();
    const filename = `audio_${sessionId}_${timestamp}.${extension}`;
    const filePath = join(AUDIO_STORAGE_DIR, filename);

    // Save audio file to disk
    await writeFile(filePath, audioBuffer);

    // Store in session memory
    const audioInfo = {
      sessionId,
      filePath,
      filename,
      contentType,
      size: audioBuffer.length,
      timestamp: new Date().toISOString(),
    };

    sessionAudioStorage.set(sessionId, audioInfo);

    logger.log('system', 'Audio stored in session', {
      sessionId,
      filename,
      size: audioBuffer.length,
    });

    return filePath;
  } catch (error) {
    logger.log('error', 'Failed to store session audio', {
      sessionId,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Get audio file info for a session
 * @param {string} sessionId - Session ID
 * @returns {Object|null} - Audio file info or null if not found
 */
export function getSessionAudio(sessionId) {
  return sessionAudioStorage.get(sessionId) || null;
}

/**
 * Read audio file from storage
 * @param {string} sessionId - Session ID
 * @returns {Promise<Buffer|null>} - Audio buffer or null if not found
 */
export async function readSessionAudio(sessionId) {
  try {
    const audioInfo = getSessionAudio(sessionId);
    if (!audioInfo) {
      return null;
    }

    const { readFile } = await import('fs/promises');
    const audioBuffer = await readFile(audioInfo.filePath);
    return audioBuffer;
  } catch (error) {
    logger.log('error', 'Failed to read session audio', {
      sessionId,
      error: error.message,
    });
    return null;
  }
}

/**
 * Clean up audio file for a session (optional cleanup)
 * @param {string} sessionId - Session ID
 * @returns {Promise<void>}
 */
export async function cleanupSessionAudio(sessionId) {
  try {
    const audioInfo = sessionAudioStorage.get(sessionId);
    if (audioInfo && existsSync(audioInfo.filePath)) {
      await unlink(audioInfo.filePath);
      sessionAudioStorage.delete(sessionId);
      logger.log('system', 'Cleaned up session audio', { sessionId, filename: audioInfo.filename });
    }
  } catch (error) {
    logger.log('error', 'Failed to cleanup session audio', {
      sessionId,
      error: error.message,
    });
  }
}

/**
 * Get all session audio info (for debugging)
 * @returns {Array} - Array of audio info objects
 */
export function getAllSessionAudio() {
  return Array.from(sessionAudioStorage.values());
}

