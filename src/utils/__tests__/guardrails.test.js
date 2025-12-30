/**
 * Unit Tests for Guardrails
 */

import { describe, it, expect } from '@jest/globals';
import { detectPII, detectInvestmentAdvice, sanitizePII } from '../guardrails.js';

describe('PII Detection', () => {
  it('should detect phone numbers', () => {
    const result1 = detectPII('My phone number is 9876543210');
    expect(result1.detected).toBe(true);
    expect(result1.type).toBe('phone');

    const result2 = detectPII('Call me at +91 9876543210');
    expect(result2.detected).toBe(true);
    expect(result2.type).toBe('phone');
  });

  it('should detect email addresses', () => {
    const result1 = detectPII('My email is user@example.com');
    expect(result1.detected).toBe(true);
    expect(result1.type).toBe('email');

    const result2 = detectPII('Contact me at test.email@domain.co.in');
    expect(result2.detected).toBe(true);
    expect(result2.type).toBe('email');
  });

  it('should detect account numbers', () => {
    const result1 = detectPII('My account number is 1234567890123456');
    expect(result1.detected).toBe(true);
    expect(result1.type).toBe('account_number');
  });

  it('should not detect PII in normal text', () => {
    const result = detectPII('I want to book an appointment');
    expect(result.detected).toBe(false);
    expect(result.type).toBe(null);
  });

  it('should handle empty or null input', () => {
    expect(detectPII('').detected).toBe(false);
    expect(detectPII(null).detected).toBe(false);
    expect(detectPII(undefined).detected).toBe(false);
  });
});

describe('Investment Advice Detection', () => {
  it('should detect investment advice requests', () => {
    expect(detectInvestmentAdvice('Should I buy this fund?')).toBe(true);
    expect(detectInvestmentAdvice('Which fund is best?')).toBe(true);
    expect(detectInvestmentAdvice('What should I invest in?')).toBe(true);
    expect(detectInvestmentAdvice('Can you recommend a good investment?')).toBe(true);
    expect(detectInvestmentAdvice('Should I sell my stocks?')).toBe(true);
  });

  it('should not detect investment advice in normal queries', () => {
    expect(detectInvestmentAdvice('I want to book an appointment')).toBe(false);
    expect(detectInvestmentAdvice('What documents do I need?')).toBe(false);
    expect(detectInvestmentAdvice('When can I speak to an advisor?')).toBe(false);
  });

  it('should handle empty or null input', () => {
    expect(detectInvestmentAdvice('')).toBe(false);
    expect(detectInvestmentAdvice(null)).toBe(false);
    expect(detectInvestmentAdvice(undefined)).toBe(false);
  });
});

describe('PII Sanitization', () => {
  it('should sanitize phone numbers', () => {
    const sanitized = sanitizePII('Call me at 9876543210');
    expect(sanitized).toContain('[REDACTED]');
    expect(sanitized).not.toContain('9876543210');
  });

  it('should sanitize email addresses', () => {
    const sanitized = sanitizePII('My email is user@example.com');
    expect(sanitized).toContain('[REDACTED]');
    expect(sanitized).not.toContain('user@example.com');
  });

  it('should sanitize account numbers', () => {
    const sanitized = sanitizePII('Account number 1234567890123456');
    expect(sanitized).toContain('[REDACTED]');
  });

  it('should preserve non-PII text', () => {
    const text = 'I want to book an appointment';
    expect(sanitizePII(text)).toBe(text);
  });
});

