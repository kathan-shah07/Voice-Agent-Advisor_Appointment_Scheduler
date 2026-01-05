/**
 * SMTP Email MCP Client
 * Connects to the SMTP Email MCP server via stdio
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

export class SMTPEmailMCPClient extends MCPClient {
    constructor() {
        super('SMTP Email MCP');
        this.client = null;
        this.transport = null;
    }

    async _doInitialize() {
        try {
            // Get MCP server path from environment or use default
            const mcpServerPath = process.env.MCP_SMTP_EMAIL_PATH ||
                path.join(__dirname, '../../../mcp-email-smtp/dist/index.js');

            // Get credentials path
            const credentialsPath = process.env.GOOGLE_CREDENTIALS_PATH ||
                path.join(__dirname, '../../../mcp-gmail-calendar/credentials.json');

            // Get tokens path (default to mcp-gmail-calendar/tokens)
            const tokensPath = process.env.TOKENS_PATH ||
                path.join(__dirname, '../../../mcp-gmail-calendar/tokens');

            logger.log('mcp', `Starting SMTP Email MCP server: ${mcpServerPath}`, {});

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
                    name: 'voice-agent-advisor-scheduler-smtp',
                    version: '1.0.0',
                },
                {
                    capabilities: {}
                }
            );

            // Connect to the server
            await this.client.connect(this.transport);

            logger.log('mcp', 'Connected to SMTP Email MCP server', {});

            return true;
        } catch (error) {
            logger.log('error', `Failed to initialize SMTP Email MCP client: ${error.message}`, { error: error.stack });
            throw error;
        }
    }

    /**
     * Execute tool
     */
    async _executeTool(toolName, params) {
        if (!this.client) {
            throw new Error('SMTP Email MCP client not initialized');
        }

        try {
            logger.log('mcp', `Calling SMTP MCP tool: ${toolName}`, { params });

            const result = await this.client.callTool({
                name: toolName,
                arguments: params
            });

            return this.parseResult(result);
        } catch (error) {
            logger.log('error', `SMTP MCP tool call failed: ${toolName}`, { error: error.message });
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
                    // Fallback for non-JSON response
                    return { text: content.text };
                }
            }
        }
        return result;
    }

    async cleanup() {
        try {
            if (this.client) {
                await this.client.close();
            }
            if (this.transport) {
                await this.transport.close();
            }
        } catch (error) {
            logger.log('error', `Error during cleanup of SMTP client: ${error.message}`, {});
        }
    }
}
