import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const mcpServerPath = path.join(__dirname, 'mcp-gmail-calendar/dist/index.js');
const credentialsPath = path.join(__dirname, 'mcp-gmail-calendar/credentials.json');

const transport = new StdioClientTransport({
  command: 'node',
  args: [mcpServerPath],
  env: {
    ...process.env,
    GOOGLE_CREDENTIALS_PATH: credentialsPath
  }
});

const client = new Client(
  { name: 'auth-script', version: '1.0.0' },
  { capabilities: {} }
);

async function authenticate() {
  try {
    await client.connect(transport);
    console.log('Connected to MCP server\n');

    // Check existing accounts
    const accountsResult = await client.callTool({
      name: 'list_accounts',
      arguments: {}
    });

    const accountsData = JSON.parse(accountsResult.content[0].text);
    console.log('Existing accounts:', accountsData.accounts?.length || 0);

    if (accountsData.accounts?.length > 0) {
      console.log('✅ You already have authenticated accounts:');
      accountsData.accounts.forEach(acc => {
        console.log(`  - ${acc.email}`);
      });
      await client.close();
      return;
    }

    // Authenticate new account
    console.log('\nNo authenticated accounts found.');
    const email = process.argv[2] || prompt('Enter your Google email: ');
    
    console.log(`\nAuthenticating ${email}...`);
    const authResult = await client.callTool({
      name: 'authenticate',
      arguments: { email, accountType: 'personal' }
    });

    const authUrl = authResult.content[0].text;
    console.log('\n🔐 Please visit this URL to authenticate:');
    console.log(authUrl);
    console.log('\nAfter authentication, tokens will be saved automatically.');
    console.log('Press Ctrl+C when done.');

    // Keep connection alive
    await new Promise(() => {});

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

authenticate();