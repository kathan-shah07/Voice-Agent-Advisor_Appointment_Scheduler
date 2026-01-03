#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  TextContent,
  ErrorCode,
  McpError
} from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';
import { SheetsService } from './services/SheetsService.js';
import { Logger } from './utils/Logger.js';
import * as tools from './tools/index.js';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class GoogleSheetsMCPServer {
  private server: Server;
  private sheetsService: SheetsService | null = null;
  private logger: Logger;

  constructor() {
    this.logger = new Logger('GoogleSheetsMCPServer');
    
    this.server = new Server(
      {
        name: 'google-sheets-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
    this.initializeService();
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.getAvailableTools(),
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      return await this.handleToolCall(name, args);
    });
  }

  private getAvailableTools(): Tool[] {
    return [
      tools.appendRowTool,
      tools.readRangeTool,
      tools.updateCellTool,
      tools.getSpreadsheetInfoTool,
    ];
  }

  private async initializeService(): Promise<void> {
    try {
      // Get service account key path from environment
      const serviceAccountKeyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || 
        path.join(__dirname, '../../credentials/service-account-key.json');

      this.logger.info(`Initializing Sheets service with service account: ${serviceAccountKeyPath}`);

      this.sheetsService = new SheetsService(serviceAccountKeyPath);
      
      this.logger.info('Google Sheets MCP Server initialized successfully');
    } catch (error: any) {
      this.logger.error('Failed to initialize Sheets service', error);
      // Don't exit - allow server to start but tools will fail
    }
  }

  private async handleToolCall(name: string, args: any): Promise<{ content: Array<TextContent> }> {
    try {
      this.logger.info(`Handling tool call: ${name}`, { args });

      if (!this.sheetsService) {
        throw new McpError(
          ErrorCode.InternalError,
          'Sheets service not initialized. Please check GOOGLE_SERVICE_ACCOUNT_KEY_PATH environment variable.'
        );
      }

      switch (name) {
        case 'sheets_append_row':
          return await this.handleAppendRow(args);
        
        case 'sheets_read_range':
          return await this.handleReadRange(args);
        
        case 'sheets_update_cell':
          return await this.handleUpdateCell(args);
        
        case 'sheets_get_info':
          return await this.handleGetInfo(args);
        
        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    } catch (error: any) {
      this.logger.error(`Error handling tool call ${name}:`, error);
      throw error;
    }
  }

  private async handleAppendRow(args: any): Promise<{ content: Array<TextContent> }> {
    const result = await this.sheetsService!.appendRows({
      spreadsheetId: args.spreadsheetId,
      sheetName: args.sheetName,
      values: args.values,
      range: args.range,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  private async handleReadRange(args: any): Promise<{ content: Array<TextContent> }> {
    const values = await this.sheetsService!.readRange({
      spreadsheetId: args.spreadsheetId,
      sheetName: args.sheetName,
      range: args.range,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ values }, null, 2),
        },
      ],
    };
  }

  private async handleUpdateCell(args: any): Promise<{ content: Array<TextContent> }> {
    const result = await this.sheetsService!.updateCell({
      spreadsheetId: args.spreadsheetId,
      sheetName: args.sheetName,
      range: args.range,
      value: args.value,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  private async handleGetInfo(args: any): Promise<{ content: Array<TextContent> }> {
    const info = await this.sheetsService!.getSpreadsheetInfo(args.spreadsheetId);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(info, null, 2),
        },
      ],
    };
  }

  async start(): Promise<void> {
    try {
      const transport = new StdioServerTransport();
      await this.server.connect(transport);

      this.logger.info('Google Sheets MCP Server started successfully');
    } catch (error: any) {
      this.logger.error('Failed to start server:', error);
      process.exit(1);
    }
  }
}

// Start the server
const server = new GoogleSheetsMCPServer();
server.start().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

