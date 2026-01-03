/**
 * Gmail & Calendar MCP Client
 * Connects to the Gmail & Calendar MCP server via stdio
 * 
 * Environment Variables Used:
 * - GOOGLE_CALENDAR_ID: Calendar ID to use for all calendar operations (default: 'primary')
 * - GOOGLE_SPREADSHEET_ID: Google Sheets ID for future Sheets operations
 * - ADVISOR_EMAIL: Email address for creating email drafts
 * - GOOGLE_SHEET_NAME: Sheet name within the spreadsheet (default: 'Advisor Pre-Bookings')
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

export class GmailCalendarMCPClient extends MCPClient {
  constructor() {
    super('Gmail & Calendar MCP');
    this.client = null;
    this.transport = null;
    this.currentAccount = null;
    // Load configuration from environment variables
    this.calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
    this.spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID || null;
    this.advisorEmail = process.env.ADVISOR_EMAIL || null;
    this.sheetName = process.env.GOOGLE_SHEET_NAME || 'Advisor Pre-Bookings';
  }

  async _doInitialize() {
    try {
      // Get MCP server path from environment or use default
      const mcpServerPath = process.env.MCP_GMAIL_CALENDAR_PATH || 
        path.join(__dirname, '../../../mcp-gmail-calendar/dist/index.js');
      
      // Get credentials path
      const credentialsPath = process.env.GOOGLE_CREDENTIALS_PATH || 
        path.join(__dirname, '../../../mcp-gmail-calendar/credentials.json');

      logger.log('mcp', `Starting Gmail & Calendar MCP server: ${mcpServerPath}`, {});

      // Get tokens path (default to mcp-gmail-calendar/tokens)
      const tokensPath = process.env.TOKENS_PATH || 
        path.join(__dirname, '../../../mcp-gmail-calendar/tokens');
      
      // Create stdio transport with command
      this.transport = new StdioClientTransport({
        command: 'node',
        args: [mcpServerPath],
        env: {
          ...process.env,
          GOOGLE_CREDENTIALS_PATH: credentialsPath,
          TOKENS_PATH: tokensPath
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

      logger.log('mcp', 'Connected to Gmail & Calendar MCP server', {
        calendarId: this.calendarId,
        spreadsheetId: this.spreadsheetId || 'not configured',
        advisorEmail: this.advisorEmail || 'not configured',
        sheetName: this.sheetName
      });

      // Ensure we have an authenticated account
      await this.ensureAuthenticated();

      return true;
    } catch (error) {
      logger.log('error', `Failed to initialize Gmail & Calendar MCP client: ${error.message}`, { error: error.stack });
      throw error;
    }
  }

  /**
   * Ensure we have an authenticated account
   * Automatically switches to the first available account or uses ADVISOR_EMAIL if set
   */
  async ensureAuthenticated() {
    try {
      // List accounts - this should find tokens that were loaded on server startup
      const accountsResult = await this.client.callTool({
        name: 'list_accounts',
        arguments: {}
      });

      if (accountsResult.content && accountsResult.content.length > 0) {
        const accountsData = JSON.parse(accountsResult.content[0].text);
        const accounts = accountsData.accounts || [];
        
        if (accounts.length > 0) {
          // Determine which account to use
          let accountToUse = null;
          
          // If ADVISOR_EMAIL is set and matches an authenticated account, use it
          if (this.advisorEmail) {
            accountToUse = accounts.find(acc => acc.email === this.advisorEmail);
            if (accountToUse) {
              logger.log('mcp', `Found ADVISOR_EMAIL in authenticated accounts: ${this.advisorEmail}`, {});
            }
          }
          
          // Otherwise, use the first available account
          if (!accountToUse) {
            accountToUse = accounts[0];
          }
          
          this.currentAccount = accountToUse.email;
          logger.log('mcp', `Selected account: ${this.currentAccount}`, {});
          
          // Always switch to ensure the account is active
          // The MCP server loads tokens but doesn't automatically set currentAccount
          try {
            await this.client.callTool({
              name: 'switch_account',
              arguments: { email: this.currentAccount }
            });
            logger.log('mcp', `Successfully switched to account: ${this.currentAccount}`, {});
            
            // Small delay to ensure account switch is processed
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Verify the account is now current
            try {
              const verifyResult = await this.client.callTool({
                name: 'get_current_account',
                arguments: {}
              });
              
              if (verifyResult.content && verifyResult.content.length > 0) {
                const currentAccountData = JSON.parse(verifyResult.content[0].text);
                if (currentAccountData.email === this.currentAccount) {
                  logger.log('mcp', `Account verified as current: ${this.currentAccount}`, {});
                } else {
                  logger.log('warning', `Account switch may have failed. Expected: ${this.currentAccount}, Got: ${currentAccountData.email || 'none'}`, {});
                }
              }
            } catch (verifyError) {
              logger.log('warning', `Could not verify current account: ${verifyError.message}`, {});
              // Continue anyway - switch_account may have succeeded
            }
            
            return true;
          } catch (switchError) {
            logger.log('error', `Failed to switch account: ${switchError.message}`, {});
            throw new Error(`Failed to switch to account ${this.currentAccount}: ${switchError.message}`);
          }
        } else {
          // No accounts found - check if we should auto-authenticate
          logger.log('mcp', 'No authenticated accounts found in MCP server', {});
          
          if (this.advisorEmail) {
            logger.log('mcp', `ADVISOR_EMAIL is set (${this.advisorEmail}), but account is not authenticated`, {});
            logger.log('mcp', 'Please run: node authenticate-mcp.js ' + this.advisorEmail, {});
            throw new Error(`No authenticated accounts found. Please authenticate first using: node authenticate-mcp.js ${this.advisorEmail}`);
          } else {
            throw new Error('No authenticated accounts found. Please authenticate first. Use: node authenticate-mcp.js your-email@gmail.com');
          }
        }
      } else {
        throw new Error('Failed to list accounts from MCP server - no response content');
      }
    } catch (error) {
      logger.log('error', `Failed to ensure authentication: ${error.message}`, {});
      throw error; // Throw to prevent silent failures - initialization should fail if auth fails
    }
  }

  /**
   * Map internal tool names to MCP server tool names
   */
  mapToolName(internalName) {
    const toolMap = {
      'event_create_tentative': 'event_create',
      'event_update_time': 'event_update',
      'event_cancel': 'event_delete',
      'calendar_get_availability': 'calendar_get_availability',
      'email_create_advisor_draft': 'email_create_draft' // Map to draft creation tool
    };

    return toolMap[internalName] || internalName;
  }

  /**
   * Map internal params to MCP server params
   */
  mapParams(internalName, params) {
    switch (internalName) {
      case 'event_create_tentative':
        // Map to event_create format with calendar ID from env
        return {
          calendarId: this.calendarId,
          event: {
            summary: params.summary,
            description: params.description,
            start: {
              dateTime: params.startDateTime,
              timeZone: 'Asia/Kolkata'
            },
            end: {
              dateTime: params.endDateTime,
              timeZone: 'Asia/Kolkata'
            },
            status: 'tentative',
            extendedProperties: {
              private: {
                bookingCode: params.bookingCode,
                isWaitlist: String(params.isWaitlist || false),
                source: 'voice-agent'
              }
            }
          }
        };

      case 'event_update_time':
        // We'll need to find the event by booking code first
        // Return params that will be used after finding the event
        return {
          bookingCode: params.bookingCode,
          newStartDateTime: params.newStartDateTime,
          newEndDateTime: params.newEndDateTime
        };

      case 'event_cancel':
        // We'll need to find the event by booking code first
        return {
          bookingCode: params.bookingCode
        };

      case 'calendar_get_availability':
        // Parse preferredDate and timeWindow into timeMin/timeMax
        const date = new Date(params.preferredDate);
        const timeWindowRanges = {
          morning: { start: 10, end: 12 },
          afternoon: { start: 12, end: 16 },
          evening: { start: 16, end: 18 },
          any: { start: 10, end: 18 }
        };
        const window = timeWindowRanges[params.timeWindow] || timeWindowRanges.any;
        
        const startTime = new Date(date);
        startTime.setHours(window.start, 0, 0, 0);
        const endTime = new Date(date);
        endTime.setHours(window.end, 0, 0, 0);

        return {
          timeMin: startTime.toISOString(),
          timeMax: endTime.toISOString(),
          items: [{ id: this.calendarId }]
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
      // Handle special cases that need event lookup by booking code
      if (toolName === 'event_update_time') {
        let eventId = params.eventId; // Use eventId from session if available
        
        // If no eventId provided, find event by booking code
        if (!eventId) {
          const event = await this.findEventByBookingCode(params.bookingCode);
          if (!event) {
            throw new Error(`Event with booking code ${params.bookingCode} not found`);
          }
          eventId = event.id;
        }

        // Update the event with calendar ID from env
        // The MCP event_update tool expects 'updates' object, not 'event'
        const mcpParams = {
          eventId: eventId,
          calendarId: this.calendarId,
          updates: {
            start: {
              dateTime: params.newStartDateTime,
              timeZone: 'Asia/Kolkata'
            },
            end: {
              dateTime: params.newEndDateTime,
              timeZone: 'Asia/Kolkata'
            }
          },
          sendNotifications: true
        };

        const result = await this.client.callTool({
          name: 'event_update',
          arguments: mcpParams
        });

        return this.parseResult(result);
      }

      if (toolName === 'event_cancel') {
        let eventId = params.eventId; // Use eventId from session if available
        
        // If no eventId provided, find event by booking code
        if (!eventId) {
          const event = await this.findEventByBookingCode(params.bookingCode);
          if (!event) {
            throw new Error(`Event with booking code ${params.bookingCode} not found`);
          }
          eventId = event.id;
        }

        const mcpParams = {
          eventId: eventId,
          calendarId: this.calendarId
        };

        const result = await this.client.callTool({
          name: 'event_delete',
          arguments: mcpParams
        });

        return this.parseResult(result);
      }

      // Handle email draft creation - try draft tool first, fallback to send if not available
      if (toolName === 'email_create_advisor_draft') {
        const mcpParams = this.mapParams(toolName, params);
        
        try {
          // Try to use draft creation tool if available
          logger.log('mcp', `Calling MCP tool: email_create_draft`, { params: mcpParams });
          const result = await this.client.callTool({
            name: 'email_create_draft',
            arguments: mcpParams
          });
          return this.parseResult(result);
        } catch (error) {
          // If draft tool doesn't exist, log warning and return success (draft creation is optional)
          if (error.message && error.message.includes('MethodNotFound')) {
            logger.log('warning', `Draft creation tool not available in MCP server. Email draft creation skipped.`, {});
            // Return mock success - draft creation is not critical
            return { id: 'draft_mock', message: 'Draft creation not yet implemented in MCP server' };
          }
          throw error;
        }
      }

      // Map tool name and params for other tools
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
      logger.log('error', `MCP tool call failed: ${toolName}`, { error: error.message });
      throw error;
    }
  }

  /**
   * Parse MCP tool result
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
   * Find event by booking code (helper method)
   * Searches both forward and backward in time to find events
   */
  async findEventByBookingCode(bookingCode) {
    try {
      // Search events in a wider range: 30 days back and 365 days forward
      const now = new Date();
      const timeMin = new Date(now);
      timeMin.setDate(timeMin.getDate() - 30); // Look back 30 days
      const timeMax = new Date(now);
      timeMax.setDate(timeMax.getDate() + 365); // Look forward 365 days
      
      const timeMinISO = timeMin.toISOString();
      const timeMaxISO = timeMax.toISOString();

      logger.log('mcp', `Searching for event with booking code: ${bookingCode}`, {
        timeMin: timeMinISO,
        timeMax: timeMaxISO,
        calendarId: this.calendarId
      });

      const result = await this.client.callTool({
        name: 'event_list',
        arguments: {
          calendarId: this.calendarId,
          timeMin: timeMinISO,
          timeMax: timeMaxISO,
          maxResults: 2500 // Increased to find more events
        }
      });

      if (result.content && result.content.length > 0) {
        const eventsData = JSON.parse(result.content[0].text);
        const events = eventsData.events || [];

        logger.log('mcp', `Found ${events.length} events to search`, {});

        // Find event with matching booking code
        for (const event of events) {
          // Check extendedProperties.private.bookingCode (primary method)
          if (event.extendedProperties?.private?.bookingCode === bookingCode) {
            logger.log('mcp', `Found event by booking code in extendedProperties: ${event.id}`, {});
            return event;
          }
          
          // Also check summary for booking code (backward compatibility)
          if (event.summary?.includes(bookingCode)) {
            logger.log('mcp', `Found event by booking code in summary: ${event.id}`, {});
            return event;
          }
          
          // Check description as well
          if (event.description?.includes(bookingCode)) {
            logger.log('mcp', `Found event by booking code in description: ${event.id}`, {});
            return event;
          }
        }
        
        logger.log('warning', `No event found with booking code: ${bookingCode}`, {
          searchedEvents: events.length
        });
      } else {
        logger.log('warning', `No events returned from calendar search`, {});
      }

      return null;
    } catch (error) {
      logger.log('error', `Failed to find event by booking code: ${error.message}`, { bookingCode });
      return null;
    }
  }

  /**
   * Get calendar ID from environment (for use in other operations)
   */
  getCalendarId() {
    return this.calendarId;
  }

  /**
   * Get Google Sheets ID from environment (for future Google Sheets operations)
   */
  getSpreadsheetId() {
    return this.spreadsheetId;
  }

  /**
   * Get advisor email from environment (for email draft operations)
   */
  getAdvisorEmail() {
    return this.advisorEmail;
  }

  /**
   * Get sheet name from environment (for Google Sheets operations)
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

