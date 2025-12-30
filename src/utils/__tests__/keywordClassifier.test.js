/**
 * Unit Tests for Keyword Classifier
 */

import { describe, it, expect } from '@jest/globals';
import { classifyIntentWithKeywords, isRateLimitError, shouldUseKeywordFallback } from '../keywordClassifier.js';
import { INTENTS } from '../../config/constants.js';

describe('Keyword Classifier', () => {
  it('should classify book_new intent', () => {
    expect(classifyIntentWithKeywords('I want to book an appointment')).toBe(INTENTS.BOOK_NEW);
    expect(classifyIntentWithKeywords('Schedule me a call')).toBe(INTENTS.BOOK_NEW);
    expect(classifyIntentWithKeywords('I need to talk to an advisor')).toBe(INTENTS.BOOK_NEW);
    expect(classifyIntentWithKeywords('Book me a slot')).toBe(INTENTS.BOOK_NEW);
  });

  it('should classify reschedule intent', () => {
    expect(classifyIntentWithKeywords('I want to reschedule')).toBe(INTENTS.RESCHEDULE);
    expect(classifyIntentWithKeywords('Change my appointment time')).toBe(INTENTS.RESCHEDULE);
    expect(classifyIntentWithKeywords('Move my booking')).toBe(INTENTS.RESCHEDULE);
    expect(classifyIntentWithKeywords('I need to change my appointment')).toBe(INTENTS.RESCHEDULE);
  });

  it('should classify cancel intent', () => {
    expect(classifyIntentWithKeywords('Cancel my appointment')).toBe(INTENTS.CANCEL);
    expect(classifyIntentWithKeywords('I can\'t make it')).toBe(INTENTS.CANCEL);
    expect(classifyIntentWithKeywords('Please cancel')).toBe(INTENTS.CANCEL);
    expect(classifyIntentWithKeywords('Remove my booking')).toBe(INTENTS.CANCEL);
  });

  it('should classify what_to_prepare intent', () => {
    expect(classifyIntentWithKeywords('What should I prepare?')).toBe(INTENTS.WHAT_TO_PREPARE);
    expect(classifyIntentWithKeywords('What documents do I need?')).toBe(INTENTS.WHAT_TO_PREPARE);
    expect(classifyIntentWithKeywords('What to bring for the meeting?')).toBe(INTENTS.WHAT_TO_PREPARE);
    expect(classifyIntentWithKeywords('Preparation checklist please')).toBe(INTENTS.WHAT_TO_PREPARE);
  });

  it('should classify check_availability intent', () => {
    expect(classifyIntentWithKeywords('When can I speak to an advisor?')).toBe(INTENTS.CHECK_AVAILABILITY);
    expect(classifyIntentWithKeywords('What slots are available?')).toBe(INTENTS.CHECK_AVAILABILITY);
    expect(classifyIntentWithKeywords('Show me available times')).toBe(INTENTS.CHECK_AVAILABILITY);
    expect(classifyIntentWithKeywords('When are you free?')).toBe(INTENTS.CHECK_AVAILABILITY);
  });

  it('should default to book_new for unclear input', () => {
    expect(classifyIntentWithKeywords('hello')).toBe(INTENTS.BOOK_NEW);
    expect(classifyIntentWithKeywords('hi there')).toBe(INTENTS.BOOK_NEW);
    expect(classifyIntentWithKeywords('')).toBe(INTENTS.BOOK_NEW);
  });
});

describe('Rate Limit Error Detection', () => {
  it('should detect rate limit errors by status code', () => {
    const error429 = { status: 429, message: 'Too many requests' };
    expect(isRateLimitError(error429)).toBe(true);
  });

  it('should detect rate limit errors by message', () => {
    const error1 = { message: 'Rate limit exceeded' };
    expect(isRateLimitError(error1)).toBe(true);
    
    const error2 = { message: 'Too many requests' };
    expect(isRateLimitError(error2)).toBe(true);
    
    const error3 = { message: 'API quota exceeded' };
    expect(isRateLimitError(error3)).toBe(true);
  });

  it('should not detect non-rate-limit errors', () => {
    const error = { status: 400, message: 'Bad request' };
    expect(isRateLimitError(error)).toBe(false);
  });
});

describe('Keyword Fallback Decision', () => {
  it('should use keyword fallback for rate limit errors', () => {
    const error = { status: 429, message: 'Rate limit exceeded' };
    expect(shouldUseKeywordFallback(error)).toBe(true);
  });

  it('should use keyword fallback for API errors', () => {
    const error400 = { status: 400, message: 'Bad request' };
    expect(shouldUseKeywordFallback(error400)).toBe(true);
    
    const error500 = { status: 500, message: 'Internal server error' };
    expect(shouldUseKeywordFallback(error500)).toBe(true);
  });

  it('should use keyword fallback for network errors', () => {
    const error = { message: 'Network timeout' };
    expect(shouldUseKeywordFallback(error)).toBe(true);
    
    const error2 = { message: 'Connection refused' };
    expect(shouldUseKeywordFallback(error2)).toBe(true);
  });

  it('should not use keyword fallback for other errors', () => {
    const error = { message: 'Some other error' };
    expect(shouldUseKeywordFallback(error)).toBe(false);
  });
});

