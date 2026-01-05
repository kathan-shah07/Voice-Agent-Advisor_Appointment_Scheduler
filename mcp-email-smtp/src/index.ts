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
import nodemailer from 'nodemailer';
import dayjs from 'dayjs';
import fs from 'fs/promises';
import path from 'path';
import { google } from 'googleapis';

dotenv.config();

// Tool definition
const createAdvisorDraftTool: Tool = {
    name: 'email_create_advisor_draft',
    description: 'Create an email for the advisor desk. If Gmail OAuth2 is available, it creates a real draft in Gmail. Otherwise, it prepares a message for SMTP.',
    inputSchema: {
        type: 'object',
        properties: {
            topic: { type: 'string' },
            slotStart: { type: 'string' },
            slotEnd: { type: 'string' },
            bookingCode: { type: 'string' },
            isWaitlist: { type: 'boolean' },
            action: { type: 'string', enum: ['created', 'rescheduled', 'cancelled'] },
            sendNow: { type: 'boolean', default: false, description: 'Actually send the email via SMTP/Gmail instead of just creating a draft.' }
        },
        required: ['topic', 'bookingCode', 'isWaitlist', 'action']
    },
};

class SMTPEmailMCPServer {
    private server: Server;
    private transporter: nodemailer.Transporter | null = null;
    private gmail: any = null;
    private oauth2Client: any = null;

    constructor() {
        this.server = new Server(
            {
                name: 'smtp-email-mcp',
                version: '1.0.0',
            },
            {
                capabilities: {
                    tools: {},
                },
            }
        );

        this.setupHandlers();
    }

    private async initializeAuth() {
        const {
            GOOGLE_CREDENTIALS_PATH,
            TOKENS_PATH,
            ADVISOR_EMAIL
        } = process.env;

        if (GOOGLE_CREDENTIALS_PATH && TOKENS_PATH && ADVISOR_EMAIL) {
            try {
                const credPath = path.resolve(GOOGLE_CREDENTIALS_PATH);
                const credentialsContent = await fs.readFile(credPath, 'utf-8');
                const credentials = JSON.parse(credentialsContent);
                const oauth = credentials.web || credentials.installed;

                const tokenPath = path.join(path.resolve(TOKENS_PATH), `${ADVISOR_EMAIL}.json`);
                const tokenContent = await fs.readFile(tokenPath, 'utf-8');
                const tokenData = JSON.parse(tokenContent);

                if (oauth && tokenData.tokens) {
                    this.oauth2Client = new google.auth.OAuth2(
                        oauth.client_id,
                        oauth.client_secret,
                        oauth.redirect_uris[0]
                    );
                    this.oauth2Client.setCredentials(tokenData.tokens);

                    this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });

                    // Also setup nodemailer for sendNow functionality via OAuth2
                    this.transporter = nodemailer.createTransport({
                        host: 'smtp.gmail.com',
                        port: 465,
                        secure: true,
                        auth: {
                            type: 'OAuth2',
                            user: ADVISOR_EMAIL,
                            clientId: oauth.client_id,
                            clientSecret: oauth.client_secret,
                            refreshToken: tokenData.tokens.refresh_token,
                            accessToken: tokenData.tokens.access_token,
                            expires: tokenData.tokens.expiry_date
                        },
                    } as any);

                    console.error(`Gmail API and SMTP initialized with OAuth2 for ${ADVISOR_EMAIL}`);
                    return;
                }
            } catch (error: any) {
                console.error(`OAuth2 initialization failed: ${error.message}.`);
            }
        }

        // Fallback to standard SMTP
        const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
        if (SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS) {
            this.transporter = nodemailer.createTransport({
                host: SMTP_HOST,
                port: parseInt(SMTP_PORT),
                secure: parseInt(SMTP_PORT) === 465,
                auth: {
                    user: SMTP_USER,
                    pass: SMTP_PASS,
                },
            });
            console.error('SMTP Transporter initialized with standard authentication');
        } else {
            console.error('No valid authentication provided. Tool will operate in Mock mode.');
        }
    }

    private setupHandlers() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: [createAdvisorDraftTool],
        }));

        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;

            if (name === 'email_create_advisor_draft') {
                return await this.handleCreateAdvisorDraft(args as any);
            }

            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        });
    }

    private async handleCreateAdvisorDraft(args: any): Promise<{ content: Array<TextContent> }> {
        const { topic, slotStart, slotEnd, bookingCode, isWaitlist, action, sendNow } = args;

        let slotString = '';
        if (isWaitlist) {
            slotString = `Waitlist: Week of ${dayjs(slotStart).format('DD MMMM YYYY')}`;
        } else {
            const start = dayjs(slotStart);
            const end = dayjs(slotEnd);
            slotString = `${start.format('dddd, D MMMM')}, ${start.format('h:mm')} to ${end.format('h:mm A')} IST`;
        }

        const advisorEmail = process.env.ADVISOR_EMAIL || 'advisors-prebooking@company.com';
        const subject = `Tentative Advisor Q&A — ${topic} — ${bookingCode}`;
        const body = `Source: Voice pre-booking agent

Topic: ${topic}

Tentative slot: ${slotString}

Booking code: ${bookingCode}

User contact and account details will be completed via a secure portal using the booking code`;

        let resultMsg = '';

        if (sendNow) {
            if (this.transporter) {
                try {
                    const fromEmail = process.env.SMTP_FROM || process.env.ADVISOR_EMAIL || process.env.SMTP_USER;
                    await this.transporter.sendMail({
                        from: fromEmail,
                        to: advisorEmail,
                        subject: subject,
                        text: body,
                    });
                    resultMsg = `Email sent successfully to ${advisorEmail}.`;
                } catch (error: any) {
                    resultMsg = `Failed to send email: ${error.message}`;
                    console.error('SMTP Send Error:', error);
                }
            } else {
                resultMsg = 'No SMTP transporter available to send email.';
            }
        } else {
            // "Draft only (no send)"
            if (this.gmail) {
                try {
                    // Create actual Gmail Draft
                    const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
                    const messageParts = [
                        `To: ${advisorEmail}`,
                        `Subject: ${utf8Subject}`,
                        'Content-Type: text/plain; charset=utf-8',
                        'MIME-Version: 1.0',
                        '',
                        body,
                    ];
                    const message = messageParts.join('\n');
                    const encodedMessage = Buffer.from(message)
                        .toString('base64')
                        .replace(/\+/g, '-')
                        .replace(/\//g, '_')
                        .replace(/=+$/, '');

                    await this.gmail.users.drafts.create({
                        userId: 'me',
                        requestBody: {
                            message: {
                                raw: encodedMessage,
                            },
                        },
                    });
                    resultMsg = `Gmail draft created successfully for ${advisorEmail}.
Subject: ${subject}
Check your Gmail "Drafts" folder.`;
                } catch (error: any) {
                    resultMsg = `Failed to create Gmail draft: ${error.message}`;
                    console.error('Gmail Draft Error:', error);
                }
            } else {
                // Fallback: Just log the draft
                resultMsg = `[MOCK/DRAFT] Gmail API not available. Draft prepared but NOT saved to mailbox.
To: ${advisorEmail}
Subject: ${subject}
Body:
${body}`;
            }
        }

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({ message: resultMsg }),
            }],
        };
    }

    async start() {
        await this.initializeAuth();
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error('Email MCP Server started');
    }
}

const server = new SMTPEmailMCPServer();
server.start().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
