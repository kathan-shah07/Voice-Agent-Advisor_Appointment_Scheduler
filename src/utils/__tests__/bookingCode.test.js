/**
 * Unit Tests for Booking Code Utilities
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { generateBookingCode, validateBookingCode, formatBookingCodeForVoice } from '../bookingCode.js';

describe('Booking Code Generation', () => {
  it('should generate a valid booking code', () => {
    const code = generateBookingCode();
    expect(code).toMatch(/^[A-Z]{2}-[A-Z0-9]{3}$/);
  });

  it('should generate unique codes', () => {
    const codes = new Set();
    const existingCodes = new Set();
    
    for (let i = 0; i < 100; i++) {
      const code = generateBookingCode(existingCodes);
      expect(codes.has(code)).toBe(false);
      codes.add(code);
      existingCodes.add(code);
    }
  });

  it('should validate correct booking code format', () => {
    expect(validateBookingCode('NL-A742')).toBe(true);
    expect(validateBookingCode('AB-123')).toBe(true);
    expect(validateBookingCode('XY-Z9A')).toBe(true);
  });

  it('should reject invalid booking code formats', () => {
    expect(validateBookingCode('NL-A7')).toBe(false); // Too short (only 2 chars after dash)
    expect(validateBookingCode('NLA742')).toBe(false); // Missing dash
    expect(validateBookingCode('NL-A7425')).toBe(false); // Too long (5 chars after dash)
    expect(validateBookingCode('')).toBe(false);
    expect(validateBookingCode(null)).toBe(false);
    expect(validateBookingCode(undefined)).toBe(false);
  });

  it('should format booking code for voice', () => {
    const formatted = formatBookingCodeForVoice('NL-A742');
    expect(formatted).toContain('N L');
    expect(formatted).toContain('dash');
    expect(formatted).toContain('seven');
    expect(formatted).toContain('four');
    expect(formatted).toContain('two');
  });

  it('should handle numbers in booking code for voice', () => {
    const formatted = formatBookingCodeForVoice('AB-123');
    expect(formatted).toContain('one');
    expect(formatted).toContain('two');
    expect(formatted).toContain('three');
  });
});

