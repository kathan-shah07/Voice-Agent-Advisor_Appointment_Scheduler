/**
 * Booking Code Generation and Validation
 */

import { BOOKING_CODE_PATTERN } from '../config/constants.js';

/**
 * Generate a random booking code in format [A-Z]{2}-[A-Z0-9]{3,4}
 * @param {Set<string>} existingCodes - Set of existing booking codes to avoid duplicates
 * @returns {string} Booking code (e.g., "NL-A742")
 */
export function generateBookingCode(existingCodes = new Set()) {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const alphanumeric = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  
  let code;
  let attempts = 0;
  const maxAttempts = 100;
  
  do {
    // Generate first two letters
    const prefix = 
      letters[Math.floor(Math.random() * letters.length)] +
      letters[Math.floor(Math.random() * letters.length)];
    
    // Generate three alphanumeric characters
    const suffix = Array.from({ length: 3 }, () => 
      alphanumeric[Math.floor(Math.random() * alphanumeric.length)]
    ).join('');
    
    code = `${prefix}-${suffix}`;
    attempts++;
    
    if (attempts > maxAttempts) {
      throw new Error('Failed to generate unique booking code after maximum attempts');
    }
  } while (existingCodes.has(code));
  
  return code;
}

/**
 * Validate booking code format
 * @param {string} code - Booking code to validate
 * @returns {boolean} True if valid format
 */
export function validateBookingCode(code) {
  if (!code || typeof code !== 'string') {
    return false;
  }
  return BOOKING_CODE_PATTERN.test(code.toUpperCase());
}

/**
 * Format booking code for voice reading (e.g., "NL-A742" -> "N L dash A seven four two")
 * @param {string} code - Booking code
 * @returns {string} Formatted for voice
 */
export function formatBookingCodeForVoice(code) {
  if (!code) return '';
  
  const parts = code.toUpperCase().split('-');
  if (parts.length !== 2) return code;
  
  const [prefix, suffix] = parts;
  const prefixSpelled = prefix.split('').join(' ');
  const suffixSpelled = suffix.split('').map(char => {
    if (/[0-9]/.test(char)) {
      const numbers = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
      return numbers[parseInt(char)];
    }
    return char;
  }).join(' ');
  
  return `${prefixSpelled} dash ${suffixSpelled}`;
}

