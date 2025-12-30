/**
 * Logger for tracking backend operations and system events
 */

export class Logger {
  constructor() {
    this.logs = [];
    this.maxLogs = 1000; // Keep last 1000 logs
  }

  /**
   * Add a log entry
   * @param {string} type - Log type (llm, keyword, system, error, tool_call)
   * @param {string} message - Log message
   * @param {Object} metadata - Additional metadata
   */
  log(type, message, metadata = {}) {
    const logEntry = {
      id: this.logs.length + 1,
      timestamp: new Date().toISOString(),
      type,
      message,
      sessionId: metadata.sessionId || null,
      ...metadata
    };
    
    this.logs.push(logEntry);
    
    // Keep only last maxLogs entries
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
    
    // Also log to console for debugging
    const emoji = this.getEmoji(type);
    console.log(`${emoji} [${type.toUpperCase()}] ${message}`, metadata);
    
    return logEntry;
  }

  /**
   * Get emoji for log type
   */
  getEmoji(type) {
    const emojis = {
      llm: '🤖',
      keyword: '🔑',
      system: '⚙️',
      error: '❌',
      tool_call: '🔧',
      rate_limit: '⏳',
      fallback: '🔄',
      intent: '🎯',
      slot_extraction: '📝'
    };
    return emojis[type] || '📋';
  }

  /**
   * Get all logs
   */
  getLogs(limit = null) {
    if (limit) {
      return this.logs.slice(-limit);
    }
    return [...this.logs];
  }

  /**
   * Get logs by type
   */
  getLogsByType(type) {
    return this.logs.filter(log => log.type === type);
  }

  /**
   * Clear all logs
   */
  clear() {
    this.logs = [];
  }

  /**
   * Get logs for a specific session
   */
  getSessionLogs(sessionId) {
    return this.logs.filter(log => log.sessionId === sessionId);
  }
}

// Singleton instance
export const logger = new Logger();

