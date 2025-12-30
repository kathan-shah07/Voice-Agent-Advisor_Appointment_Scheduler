/**
 * Jest Test Setup
 * Ensures test environment is properly configured
 */

// Set NODE_ENV to test if not already set
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'test';
}

// Suppress console warnings about test environment detection
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;

// Track if API calls are attempted
let apiCallAttempted = false;

// Override console methods to detect API call attempts
console.log = (...args) => {
  const message = args.join(' ');
  if (message.includes('Groq client initialized') || message.includes('Claude client initialized')) {
    apiCallAttempted = true;
    originalConsoleWarn('⚠️  WARNING: AI client initialization detected in test environment. This should not happen.');
  }
  originalConsoleLog(...args);
};

console.warn = (...args) => {
  const message = args.join(' ');
  if (message.includes('Groq') || message.includes('Claude') || message.includes('API')) {
    apiCallAttempted = true;
  }
  originalConsoleWarn(...args);
};

// Export helper to check if API was called
export function wasAPICalled() {
  return apiCallAttempted;
}

// Reset API call flag
export function resetAPICallFlag() {
  apiCallAttempted = false;
}

