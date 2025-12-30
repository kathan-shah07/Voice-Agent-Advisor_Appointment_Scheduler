/**
 * Unit Tests for Rate Limiter
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { RateLimiter } from '../rateLimiter.js';

describe('Rate Limiter', () => {
  let limiter;

  beforeEach(() => {
    limiter = new RateLimiter(5, 1000); // 5 requests per second for testing
  });

  it('should allow requests within limit', async () => {
    // Make 5 requests quickly
    for (let i = 0; i < 5; i++) {
      await limiter.waitIfNeeded();
    }
    
    expect(limiter.getCurrentCount()).toBe(5);
  });

  it('should wait when limit is exceeded', async () => {
    const startTime = Date.now();
    
    // Make 6 requests (exceeds limit of 5)
    for (let i = 0; i < 6; i++) {
      await limiter.waitIfNeeded();
    }
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    // Should have waited at least some time
    expect(duration).toBeGreaterThan(0);
  });

  it('should track request count correctly', async () => {
    expect(limiter.getCurrentCount()).toBe(0);
    
    await limiter.waitIfNeeded();
    expect(limiter.getCurrentCount()).toBe(1);
    
    await limiter.waitIfNeeded();
    expect(limiter.getCurrentCount()).toBe(2);
  });

  it('should reset correctly', async () => {
    await limiter.waitIfNeeded();
    await limiter.waitIfNeeded();
    
    expect(limiter.getCurrentCount()).toBe(2);
    
    limiter.reset();
    expect(limiter.getCurrentCount()).toBe(0);
  });

  it('should clean up old requests', async () => {
    // Make requests
    for (let i = 0; i < 3; i++) {
      await limiter.waitIfNeeded();
    }
    
    expect(limiter.getCurrentCount()).toBe(3);
    
    // Wait for window to expire
    await new Promise(resolve => setTimeout(resolve, 1100));
    
    // Count should be cleaned up
    const count = limiter.getCurrentCount();
    expect(count).toBeLessThan(3);
  });
});

