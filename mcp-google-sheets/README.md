# Google Sheets MCP Server

MCP (Model Context Protocol) server for Google Sheets operations using service account authentication.

## Features

- Append rows to Google Sheets
- Read data from ranges
- Update cells
- Get spreadsheet metadata
- Service account authentication (no OAuth required)

## Setup

### 1. Prerequisites

- Node.js 18+
- Google Cloud Project with Sheets API enabled
- Service Account with Sheets API access

### 2. Service Account Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create or select a project
3. Enable Google Sheets API
4. Create a Service Account:
   - Go to "IAM & Admin" → "Service Accounts"
   - Click "Create Service Account"
   - Give it a name and grant it "Editor" role (or custom role with Sheets API access)
5. Create and download JSON key:
   - Click on the service account
   - Go to "Keys" tab
   - Click "Add Key" → "Create new key" → JSON
   - Save the file as `service-account-key.json`

### 3. Share Spreadsheet with Service Account

1. Open your Google Sheet
2. Click "Share" button
3. Add the service account email (found in the JSON key file, `client_email` field)
4. Give it "Editor" permissions

### 4. Environment Variables

Set these in your `.env` file or environment:

```bash
GOOGLE_SERVICE_ACCOUNT_KEY_PATH=./credentials/service-account-key.json
GOOGLE_SPREADSHEET_ID=your_spreadsheet_id_here
GOOGLE_SHEET_NAME=Advisor Pre-Bookings
```

### 5. Installation

```bash
cd mcp-google-sheets
npm install
npm run build
```

## Usage

### Standalone

```bash
npm start
```

### As MCP Server

The server communicates via stdio and can be used with any MCP client.

## Available Tools

### `sheets_append_row`
Append one or more rows to a sheet.

**Parameters:**
- `spreadsheetId` (string, required): Google Sheets spreadsheet ID
- `sheetName` (string, required): Name of the sheet
- `values` (array, required): Array of rows, where each row is an array of cell values

### `sheets_read_range`
Read data from a range.

**Parameters:**
- `spreadsheetId` (string, required)
- `sheetName` (string, required)
- `range` (string, required): Range like "A1:B10" or "A:Z"

### `sheets_update_cell`
Update a cell or range.

**Parameters:**
- `spreadsheetId` (string, required)
- `sheetName` (string, required)
- `range` (string, required): Cell or range like "A1" or "A1:B10"
- `value` (string|number|boolean, required): Value to set

### `sheets_get_info`
Get spreadsheet metadata.

**Parameters:**
- `spreadsheetId` (string, required)

## Integration with Voice Agent

The MCP client (`src/services/mcp/googleSheetsMCPClient.js`) automatically:
- Connects to this MCP server
- Maps `notes_append_prebooking` tool calls to `sheets_append_row`
- Formats data according to the pre-booking schema

## Troubleshooting

### "Sheets service not initialized"
- Check that `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` is set correctly
- Verify the service account key file exists and is valid JSON

### "Permission denied" errors
- Ensure the service account email has been shared with the spreadsheet
- Verify the service account has "Editor" permissions

### "Spreadsheet not found"
- Check that `GOOGLE_SPREADSHEET_ID` is correct
- Verify the spreadsheet ID is in the URL: `https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit`

