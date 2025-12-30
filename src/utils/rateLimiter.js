/**
 * Rate Limiter for API Calls
 * Prevents hitting API rate limits by throttling requests
 */

export class RateLimiter {
  constructor(maxRequests = 30, windowMs = 60000) {
    // Default: 30 requests per 60 seconds (conservative for Groq)
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.requests = [];
  }

  /**
   * Check if a request can be made, and wait if necessary
   * @returns {Promise<void>}
   */
  async waitIfNeeded() {
    const now = Date.now();
    
    // Remove requests outside the time window
    this.requests = this.requests.filter(timestamp => now - timestamp < this.windowMs);
    
    // If we're at the limit, wait until the oldest request expires
    if (this.requests.length >= this.maxRequests) {
      const oldestRequest = this.requests[0];
      const waitTime = this.windowMs - (now - oldestRequest) + 100; // Add 100ms buffer
      
      if (waitTime > 0) {
        console.log(`⏳ Rate limit: Waiting ${Math.ceil(waitTime / 1000)}s before next API call...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        
        // Clean up again after waiting
        const newNow = Date.now();
        this.requests = this.requests.filter(timestamp => newNow - timestamp < this.windowMs);
      }
    }
    
    // Record this request
    this.requests.push(Date.now());
  }

  /**
   * Get current request count in the window
   * @returns {number}
   */
  getCurrentCount() {
    const now = Date.now();
    this.requests = this.requests.filter(timestamp => now - timestamp < this.windowMs);
    return this.requests.length;
  }

  /**
   * Reset the rate limiter
   */
  reset() {
    this.requests = [];
  }
}

// Create singleton instances for different API types
export const intentClassificationLimiter = new RateLimiter(
  parseInt(process.env.API_RATE_LIMIT_INTENT || '30'), // 30 requests per minute
  60000 // 60 seconds
);

export const slotExtractionLimiter = new RateLimiter(
  parseInt(process.env.API_RATE_LIMIT_SLOTS || '30'), // 30 requests per minute
  60000 // 60 seconds
);

export const generalAPILimiter = new RateLimiter(
  parseInt(process.env.API_RATE_LIMIT_GENERAL || '30'), // 30 requests per minute
  60000 // 60 seconds
);

