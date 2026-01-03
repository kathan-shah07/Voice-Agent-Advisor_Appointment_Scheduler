import { sheets_v4, google } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';
import { TextContent, McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { Logger } from '../utils/Logger.js';

export interface AppendRowParams {
  spreadsheetId: string;
  sheetName: string;
  values: any[][];
  range?: string;
}

export interface ReadRangeParams {
  spreadsheetId: string;
  sheetName: string;
  range: string;
}

export interface UpdateCellParams {
  spreadsheetId: string;
  sheetName: string;
  range: string;
  value: any;
}

export class SheetsService {
  private sheets: sheets_v4.Sheets;
  private logger: Logger;
  private auth: GoogleAuth;

  constructor(serviceAccountKeyPath: string) {
    this.logger = new Logger('SheetsService');
    
    // Initialize Google Auth with service account
    this.auth = new GoogleAuth({
      keyFile: serviceAccountKeyPath,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    this.sheets = google.sheets({ version: 'v4', auth: this.auth });
  }

  /**
   * Append rows to a sheet
   */
  async appendRows(params: AppendRowParams): Promise<{ updatedCells: number; updatedRange: string }> {
    try {
      const range = params.range || `${params.sheetName}!A:Z`;
      
      const response = await this.sheets.spreadsheets.values.append({
        spreadsheetId: params.spreadsheetId,
        range: range,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: params.values,
        },
      });

      this.logger.info(`Appended ${params.values.length} row(s) to sheet`, {
        spreadsheetId: params.spreadsheetId,
        sheetName: params.sheetName,
        updatedCells: response.data.updates?.updatedCells || 0,
      });

      return {
        updatedCells: response.data.updates?.updatedCells || 0,
        updatedRange: response.data.updates?.updatedRange || '',
      };
    } catch (error: any) {
      this.logger.error('Failed to append rows to sheet', error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to append rows: ${error.message}`
      );
    }
  }

  /**
   * Read data from a range
   */
  async readRange(params: ReadRangeParams): Promise<any[][]> {
    try {
      const range = `${params.sheetName}!${params.range}`;
      
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: params.spreadsheetId,
        range: range,
      });

      const values = response.data.values || [];
      
      this.logger.info(`Read ${values.length} row(s) from sheet`, {
        spreadsheetId: params.spreadsheetId,
        sheetName: params.sheetName,
        range: params.range,
      });

      return values;
    } catch (error: any) {
      this.logger.error('Failed to read range from sheet', error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to read range: ${error.message}`
      );
    }
  }

  /**
   * Update a cell or range
   */
  async updateCell(params: UpdateCellParams): Promise<{ updatedCells: number; updatedRange: string }> {
    try {
      const range = `${params.sheetName}!${params.range}`;
      
      const response = await this.sheets.spreadsheets.values.update({
        spreadsheetId: params.spreadsheetId,
        range: range,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [[params.value]],
        },
      });

      this.logger.info('Updated cell in sheet', {
        spreadsheetId: params.spreadsheetId,
        sheetName: params.sheetName,
        range: params.range,
        updatedCells: response.data.updatedCells || 0,
      });

      return {
        updatedCells: response.data.updatedCells || 0,
        updatedRange: response.data.updatedRange || '',
      };
    } catch (error: any) {
      this.logger.error('Failed to update cell in sheet', error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to update cell: ${error.message}`
      );
    }
  }

  /**
   * Get spreadsheet metadata
   */
  async getSpreadsheetInfo(spreadsheetId: string): Promise<any> {
    try {
      const response = await this.sheets.spreadsheets.get({
        spreadsheetId: spreadsheetId,
      });

      return {
        title: response.data.properties?.title,
        sheets: response.data.sheets?.map(sheet => ({
          title: sheet.properties?.title,
          sheetId: sheet.properties?.sheetId,
        })),
      };
    } catch (error: any) {
      this.logger.error('Failed to get spreadsheet info', error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get spreadsheet info: ${error.message}`
      );
    }
  }
}

