import { Tool } from '@modelcontextprotocol/sdk/types.js';

export const appendRowTool: Tool = {
  name: 'sheets_append_row',
  description: 'Append a row to a Google Sheet',
  inputSchema: {
    type: 'object',
    properties: {
      spreadsheetId: {
        type: 'string',
        description: 'Google Sheets spreadsheet ID',
      },
      sheetName: {
        type: 'string',
        description: 'Name of the sheet within the spreadsheet',
      },
      values: {
        type: 'array',
        items: {
          type: 'array',
          items: {
            type: ['string', 'number', 'boolean', 'null'],
          },
        },
        description: 'Array of rows, where each row is an array of cell values',
      },
    },
    required: ['spreadsheetId', 'sheetName', 'values'],
  },
};

export const readRangeTool: Tool = {
  name: 'sheets_read_range',
  description: 'Read data from a range in a Google Sheet',
  inputSchema: {
    type: 'object',
    properties: {
      spreadsheetId: {
        type: 'string',
        description: 'Google Sheets spreadsheet ID',
      },
      sheetName: {
        type: 'string',
        description: 'Name of the sheet within the spreadsheet',
      },
      range: {
        type: 'string',
        description: 'Range to read (e.g., "A1:B10" or "A:Z")',
      },
    },
    required: ['spreadsheetId', 'sheetName', 'range'],
  },
};

export const updateCellTool: Tool = {
  name: 'sheets_update_cell',
  description: 'Update a cell or range in a Google Sheet',
  inputSchema: {
    type: 'object',
    properties: {
      spreadsheetId: {
        type: 'string',
        description: 'Google Sheets spreadsheet ID',
      },
      sheetName: {
        type: 'string',
        description: 'Name of the sheet within the spreadsheet',
      },
      range: {
        type: 'string',
        description: 'Cell or range to update (e.g., "A1" or "A1:B10")',
      },
      value: {
        type: ['string', 'number', 'boolean'],
        description: 'Value to set',
      },
    },
    required: ['spreadsheetId', 'sheetName', 'range', 'value'],
  },
};

export const getSpreadsheetInfoTool: Tool = {
  name: 'sheets_get_info',
  description: 'Get metadata about a Google Sheet',
  inputSchema: {
    type: 'object',
    properties: {
      spreadsheetId: {
        type: 'string',
        description: 'Google Sheets spreadsheet ID',
      },
    },
    required: ['spreadsheetId'],
  },
};

