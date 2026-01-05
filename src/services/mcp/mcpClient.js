/**
 * MCP Client - Base infrastructure for MCP service integration
 * This provides a unified interface for MCP-compatible services
 */

import { logger } from '../../utils/logger.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Base MCP Client class
 */
export class MCPClient {
  constructor(serviceName) {
    this.serviceName = serviceName;
    this.enabled = process.env.ENABLE_MCP === 'true';
    this.initialized = false;
  }

  /**
   * Initialize the MCP client
   * @returns {Promise<boolean>} Success status
   */
  async initialize() {
    if (!this.enabled) {
      logger.log('mcp', `${this.serviceName}: MCP disabled, using mock mode`, {});
      return false;
    }

    try {
      await this._doInitialize();
      this.initialized = true;
      logger.log('mcp', `✅ ${this.serviceName}: Initialized successfully`, {});
      return true;
    } catch (error) {
      logger.log('error', `⚠️  ${this.serviceName}: Failed to initialize`, { error: error.message });
      this.initialized = false;
      return false;
    }
  }

  /**
   * Override in subclasses
   */
  async _doInitialize() {
    throw new Error('_doInitialize must be implemented by subclass');
  }

  /**
   * Check if service is available
   */
  isAvailable() {
    return this.enabled && this.initialized;
  }

  /**
   * Execute a tool call with error handling
   */
  async executeTool(toolName, params) {
    if (!this.isAvailable()) {
      throw new Error(`${this.serviceName} is not available (MCP disabled or not initialized)`);
    }

    try {
      logger.log('mcp', `${this.serviceName}: Executing ${toolName}`, { params });
      const result = await this._executeTool(toolName, params);
      logger.log('mcp', `${this.serviceName}: ${toolName} completed`, { result });
      return result;
    } catch (error) {
      logger.log('error', `${this.serviceName}: ${toolName} failed`, { error: error.message, params });
      throw error;
    }
  }

  /**
   * Override in subclasses
   */
  async _executeTool(toolName, params) {
    throw new Error('_executeTool must be implemented by subclass');
  }
}




