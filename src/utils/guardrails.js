/**
 * Guardrails: PII Detection and Investment Advice Detection
 */

import { PII_PATTERNS, INVESTMENT_ADVICE_KEYWORDS } from '../config/constants.js';

/**
 * Detect PII (Personally Identifiable Information) in text
 * @param {string} text - Text to check
 * @returns {Object} { detected: boolean, type: string|null, message: string }
 */
export function detectPII(text) {
  if (!text || typeof text !== 'string') {
    return { detected: false, type: null, message: null };
  }
  
  const normalizedText = text.toLowerCase();
  
  // Check for phone numbers
  if (PII_PATTERNS.PHONE.test(text)) {
    return {
      detected: true,
      type: 'phone',
      message: 'Phone number detected'
    };
  }
  
  // Check for email addresses
  if (PII_PATTERNS.EMAIL.test(text)) {
    return {
      detected: true,
      type: 'email',
      message: 'Email address detected'
    };
  }
  
  // Check for account numbers (10+ digits)
  if (PII_PATTERNS.ACCOUNT_NUMBER.test(text)) {
    return {
      detected: true,
      type: 'account_number',
      message: 'Account number detected'
    };
  }
  
  return { detected: false, type: null, message: null };
}

/**
 * Detect investment advice requests
 * @param {string} text - Text to check
 * @returns {boolean} True if investment advice is requested
 */
export function detectInvestmentAdvice(text) {
  if (!text || typeof text !== 'string') {
    return false;
  }
  
  const normalizedText = text.toLowerCase();
  
  return INVESTMENT_ADVICE_KEYWORDS.some(keyword => 
    normalizedText.includes(keyword)
  );
}

/**
 * Sanitize text by removing detected PII
 * @param {string} text - Text to sanitize
 * @returns {string} Sanitized text
 */
export function sanitizePII(text) {
  if (!text || typeof text !== 'string') {
    return text;
  }
  
  let sanitized = text;
  
  // Remove phone numbers
  sanitized = sanitized.replace(PII_PATTERNS.PHONE, '[REDACTED]');
  
  // Remove email addresses
  sanitized = sanitized.replace(PII_PATTERNS.EMAIL, '[REDACTED]');
  
  // Remove account numbers (be careful not to remove dates)
  sanitized = sanitized.replace(/\b\d{10,}\b/g, '[REDACTED]');
  
  return sanitized;
}

