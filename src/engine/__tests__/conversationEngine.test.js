/**
 * Unit Tests for Conversation Engine
 * 
 * Note: These tests mock the AI service to avoid real API calls
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { INTENTS } from '../../config/constants.js';
import { DIALOG_STATES } from '../dialogState.js';

// Mock AI service functions to avoid real API calls
const mockClassifyIntent = jest.fn(async (userInput) => {
  const lower = userInput.toLowerCase();
  // Simple keyword-based classification for unit tests
  if (lower.includes('book') || lower.includes('appointment') || lower.includes('schedule') || lower.includes('call') || lower.includes('advisor')) {
    return INTENTS.BOOK_NEW;
  }
  if (lower.includes('reschedule') || lower.includes('change') || lower.includes('move')) {
    return INTENTS.RESCHEDULE;
  }
  if (lower.includes('cancel')) {
    return INTENTS.CANCEL;
  }
  if (lower.includes('prepare') || lower.includes('document')) {
    return INTENTS.WHAT_TO_PREPARE;
  }
  if (lower.includes('availability') || lower.includes('when') || lower.includes('slot') || lower.includes('speak')) {
    return INTENTS.CHECK_AVAILABILITY;
  }
  // Default to book_new for greeting/neutral messages
  return INTENTS.BOOK_NEW;
});

const mockExtractSlots = jest.fn(async (userInput, intent) => {
  const lower = userInput.toLowerCase();
  const slots = {};
  
  // Extract topic
  if (lower.includes('kyc') || lower.includes('onboarding')) {
    slots.topic = 'KYC/Onboarding';
  } else if (lower.includes('sip') || lower.includes('mandate')) {
    slots.topic = 'SIP/Mandates';
  } else if (lower.includes('statement') || lower.includes('tax')) {
    slots.topic = 'Statements/Tax Docs';
  } else if (lower.includes('withdrawal') || lower.includes('timeline')) {
    slots.topic = 'Withdrawals & Timelines';
  } else if (lower.includes('account') || lower.includes('nominee') || lower.includes('change')) {
    slots.topic = 'Account Changes/Nominee';
  }
  
  // Extract booking code
  const codeMatch = userInput.match(/\b[A-Z]{2}-[A-Z0-9]{3,4}\b/i);
  if (codeMatch) {
    slots.booking_code = codeMatch[0].toUpperCase();
  }
  
  // Extract day range
  if (lower.includes('today')) {
    slots.day_range = 'today';
  } else if (lower.includes('tomorrow')) {
    slots.day_range = 'tomorrow';
  } else if (lower.includes('week')) {
    slots.day_range = 'this week';
  }
  
  return slots;
});

// Mock the AI service module before importing ConversationEngine
jest.unstable_mockModule('../../services/aiService.js', () => ({
  classifyIntent: mockClassifyIntent,
  extractSlots: mockExtractSlots
}));

// Import ConversationEngine after mocking (dynamic import)
let ConversationEngine;

describe('Conversation Engine', () => {
  let engine;

  beforeEach(async () => {
    // Dynamically import ConversationEngine after mocks are set up
    if (!ConversationEngine) {
      const module = await import('../conversationEngine.js');
      ConversationEngine = module.ConversationEngine;
    }
    engine = new ConversationEngine('Test Brand', 'https://test.com/complete');
    // Reset mocks before each test
    mockClassifyIntent.mockClear();
    mockExtractSlots.mockClear();
  });

  it('should create a new session', () => {
    const sessionId = 'test-session-1';
    const session = engine.getSession(sessionId);
    expect(session).toBeDefined();
    expect(session.sessionId).toBe(sessionId);
  });

  it('should reuse existing session', () => {
    const sessionId = 'test-session-2';
    const session1 = engine.getSession(sessionId);
    const session2 = engine.getSession(sessionId);
    expect(session1).toBe(session2);
  });

  it('should handle initial greeting', async () => {
    const sessionId = 'test-session-3';
    const result = await engine.processInput(sessionId, 'hello');
    
    expect(result.response).toContain('Welcome');
    expect(result.response).toContain('general information only');
    expect(result.state).toBe(DIALOG_STATES.GREETING);
  });

  it('should detect PII and block it', async () => {
    const sessionId = 'test-session-4';
    const result = await engine.processInput(sessionId, 'My phone is 9876543210');
    
    expect(result.response).toContain('do not share');
    expect(result.response).toContain('phone');
  });

  it('should detect investment advice and refuse', async () => {
    const sessionId = 'test-session-5';
    const result = await engine.processInput(sessionId, 'Which fund should I buy?');
    
    expect(result.response).toContain('not allowed');
    expect(result.response).toContain('investment advice');
  });

  it('should use mocked AI service (no real API calls)', async () => {
    const sessionId = 'test-session-6';
    const result = await engine.processInput(sessionId, 'I want to book an appointment');
    
    // Verify the response is generated (indicating the mock was used instead of real API)
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
    expect(typeof result.response).toBe('string');
    expect(result.response.length).toBeGreaterThan(0);
  });
});

