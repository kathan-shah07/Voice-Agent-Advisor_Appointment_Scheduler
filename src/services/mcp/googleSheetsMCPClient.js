/**
 * Google Sheets MCP Client
 * Connects to the Google Sheets MCP server via stdio
 * 
 * Environment Variables Used:
 * - GOOGLE_SPREADSHEET_ID: Google Sheets ID for the pre-booking spreadsheet
 * - GOOGLE_SHEET_NAME: Sheet name within the spreadsheet (default: 'Advisor Pre-Bookings')
 * - MCP_GOOGLE_SHEETS_PATH: Path to the MCP server executable (optional)
 * - GOOGLE_SERVICE_ACCOUNT_KEY_PATH: Path to service account key file
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { MCPClient } from './mcpClient.js';
import { logger } from '../../utils/logger.js';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class GoogleSheetsMCPClient extends MCPClient {
  constructor() {
    super('Google Sheets MCP');
    this.client = null;
    this.transport = null;
    // Load configuration from environment variables
    this.spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID || null;
    this.sheetName = process.env.GOOGLE_SHEET_NAME || 'Advisor Pre-Bookings';
  }

  async _doInitialize() {
    try {
      // Get MCP server path from environment or use default
      const mcpServerPath = process.env.MCP_GOOGLE_SHEETS_PATH || 
        path.join(__dirname, '../../../mcp-google-sheets/dist/index.js');
      
      // Get service account key path
      const serviceAccountKeyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || 
        path.join(__dirname, '../../../credentials/service-account-key.json');

      logger.log('mcp', `Starting Google Sheets MCP server: ${mcpServerPath}`, {});

      // Create stdio transport with command
      this.transport = new StdioClientTransport({
        command: 'node',
        args: [mcpServerPath],
        env: {
          ...process.env,
          GOOGLE_SERVICE_ACCOUNT_KEY_PATH: serviceAccountKeyPath
        }
      });

      // Create MCP client
      this.client = new Client(
        {
          name: 'voice-agent-advisor-scheduler',
          version: '1.0.0',
        },
        {
          capabilities: {}
        }
      );

      // Connect to the server
      await this.client.connect(this.transport);

      logger.log('mcp', 'Connected to Google Sheets MCP server', {
        spreadsheetId: this.spreadsheetId || 'not configured',
        sheetName: this.sheetName
      });

      return true;
    } catch (error) {
      logger.log('error', `Failed to initialize Google Sheets MCP client: ${error.message}`, { error: error.stack });
      throw error;
    }
  }

  /**
   * Map internal tool names to MCP server tool names
   */
  mapToolName(internalName) {
    const toolMap = {
      'notes_append_prebooking': 'sheets_append_row'
    };

    return toolMap[internalName] || internalName;
  }

  /**
   * Map internal params to MCP server params
   */
  mapParams(internalName, params) {
    switch (internalName) {
      case 'notes_append_prebooking':
        // Format the row data for Google Sheets
        const row = [
          params.createdAt || new Date().toISOString(),
          params.topic || '',
          params.slotStart ? new Date(params.slotStart).toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }) : '',
          params.slotEnd ? new Date(params.slotEnd).toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }) : '',
          params.bookingCode || '',
          params.isWaitlist ? 'true' : 'false',
          params.action || 'created',
          'voice-agent'
        ];

        return {
          spreadsheetId: this.spreadsheetId,
          sheetName: this.sheetName,
          values: [row] // Array of rows, each row is an array of values
        };

      default:
        return params;
    }
  }

  async _executeTool(toolName, params) {
    if (!this.client) {
      throw new Error('MCP client not initialized');
    }

    try {
      // Map tool name and params
      const mcpToolName = this.mapToolName(toolName);
      const mcpParams = this.mapParams(toolName, params);

      logger.log('mcp', `Calling MCP tool: ${mcpToolName}`, { params: mcpParams });

      // Call the MCP tool
      const result = await this.client.callTool({
        name: mcpToolName,
        arguments: mcpParams
      });

      return this.parseResult(result);
    } catch (error) {
      logger.log('error', `MCP tool call failed: ${toolName}`, { error: error.message, params });
      throw error;
    }
  }

  /**
   * Parse MCP result
   */
  parseResult(result) {
    if (result.content && result.content.length > 0) {
      const content = result.content[0];
      if (content.type === 'text') {
        try {
          return JSON.parse(content.text);
        } catch {
          return { text: content.text };
        }
      }
    }
    return result;
  }

  /**
   * Get spreadsheet ID from environment
   */
  getSpreadsheetId() {
    return this.spreadsheetId;
  }

  /**
   * Get sheet name from environment
   */
  getSheetName() {
    return this.sheetName;
  }

  /**
   * Cleanup: close client and transport
   */
  async cleanup() {
    try {
      if (this.client) {
        await this.client.close();
      }
      if (this.transport) {
        await this.transport.close();
      }
    } catch (error) {
      logger.log('error', `Error during cleanup: ${error.message}`, {});
    }
  }
}
