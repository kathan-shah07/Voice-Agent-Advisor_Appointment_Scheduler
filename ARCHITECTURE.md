# Voice Agent: Advisor Appointment Scheduler - Architecture

## 1. System Overview

A voice-based appointment scheduling system that allows users to book, reschedule, and cancel advisor consultations via phone calls. The system uses AI (Groq/Claude/Gemini) for natural language understanding and conversation management, integrates with MCP (Model Context Protocol) servers for calendar/email/notes, and maintains strict no-PII (Personally Identifiable Information) guardrails.

### Key Features
- **5 Core Intents**: Book new, Reschedule, Cancel, "What to prepare", Check availability windows
- **No PII Collection**: Strict guardrails prevent collection of phone numbers, emails, or account numbers during calls
- **IST Timezone**: All times are in Indian Standard Time (IST) with explicit date/time confirmation
- **Booking Code System**: Generates unique codes (e.g., NL-A742) for tracking appointments
- **MCP Integration**: Calendar holds, notes/documentation, and email drafts via MCP servers

## 2. System Architecture

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        User (Phone Call)                         │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Telephony Layer                               │
│  (Twilio/AWZ/Awav/Jambonz) - Media Streams                     │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Voice Processing Layer                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │ Speech-to-  │  │   AI/LLM     │  │ Text-to-     │         │
│  │   Text      │→ │  (Groq/      │→ │  Speech     │         │
│  │ (Google STT)│  │  Claude/     │  │ (Google TTS)│         │
│  │             │  │  Gemini)    │  │             │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Conversation Engine                           │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Dialog State Machine                                     │  │
│  │  - Intent Classification                                  │  │
│  │  - Slot Filling (topic, date/time, booking_code)         │  │
│  │  - Topic Taxonomy Mapping                                 │  │
│  │  - Date/Time Parsing (IST)                                │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Guardrails                                               │  │
│  │  - PII Detection & Blocking                               │  │
│  │  - Investment Advice Refusal                             │  │
│  │  - Timezone Validation                                    │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Business Logic                                           │  │
│  │  - Availability Service (Mock/Real)                       │  │
│  │  - Booking Code Generation                               │  │
│  │  - Waitlist Management                                    │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    MCP Integration Layer                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │   Calendar   │  │    Notes/    │  │    Email     │         │
│  │   MCP Server │  │    Doc MCP   │  │   Draft MCP  │         │
│  │              │  │    Server    │  │    Server    │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    External Services                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │   Google     │  │   Google     │  │    Gmail     │         │
│  │   Calendar   │  │   Sheets/    │  │   (Drafts)   │         │
│  │              │  │   Docs       │  │              │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Component Details

#### 2.2.1 Telephony Layer
- **Purpose**: Handle inbound phone calls and audio streaming
- **Options**: 
  - Twilio Programmable Voice with Media Streams
  - AWZ/Awav voice platform
  - Jambonz (Docker-based, optional)
- **Responsibilities**:
  - Receive phone calls
  - Stream audio to/from backend
  - Handle call termination

#### 2.2.2 Voice Processing Layer
- **Speech-to-Text (STT)**:
  - Google Cloud Speech-to-Text API
  - Alternative: ElevenLabs STT
  - Voice logger: Store all inputs in text file for debugging
- **AI/LLM Engine**:
  - Primary: Groq API (fast inference)
  - Alternatives: Claude API, Gemini API
  - Function calling enabled for MCP tool integration
- **Text-to-Speech (TTS)**:
  - Google Cloud Text-to-Speech API
  - Alternative: ElevenLabs TTS

#### 2.2.3 Conversation Engine
- **Dialog State Machine**:
  - Finite-state or frame-based dialog manager
  - Handles 5 intents with state transitions
  - Manages conversation context and session state
- **Intent Handlers**:
  1. **Book New**: Collect topic → time preference → offer slots → confirm → create booking
  2. **Reschedule**: Validate booking code → collect new time → update booking
  3. **Cancel**: Validate booking code → cancel booking
  4. **What to Prepare**: Provide topic-specific preparation guidelines
  5. **Check Availability**: Return available time windows
- **NLU Components**:
  - Intent classification (LLM-based or classifier)
  - Slot extraction (topic, date/time, booking_code)
  - Topic taxonomy mapping (5 fixed topics)
  - Date/time parsing for IST timezone
- **Guardrails**:
  - PII detection (regex/heuristic) - blocks phone, email, account numbers
  - Investment advice refusal - redirects to educational resources
  - Timezone validation - ensures IST format
- **Business Logic**:
  - Availability Service: Mock (Phase 1) or Real (Phase 2+)
    - Working days: Mon-Sat, 10:00-18:00 IST
    - Slot length: 30 minutes
    - Returns 2 candidate slots
  - Booking Code Generation: Pattern [A-Z]{2}-[A-Z0-9]{3} (e.g., NL-A742)
  - Waitlist Management: Handles cases when no slots match

#### 2.2.4 MCP Integration Layer
- **Calendar MCP Server**:
  - Tool: `event_create_tentative` - Create tentative holds
  - Tool: `event_update_time` - Reschedule existing holds
  - Tool: `event_cancel` - Cancel holds
  - Tool: `calendar_get_availability` - Get available slots
  - Backend: Google Calendar via service account
- **Notes/Doc MCP Server**:
  - Tool: `notes_append_prebooking` - Append booking entries
  - Backend: Google Sheets or Google Docs
  - Format: CSV-like or JSON lines with booking details
- **Email Draft MCP Server**:
  - Tool: `email_create_advisor_draft` - Create email drafts
  - Backend: Gmail via SMTP (Nodemailer) or Gmail API
  - Behavior: Draft only, never auto-send

## 3. Data Flow

### 3.1 Book New Appointment Flow

```
User Call → STT → Text Input
    ↓
Conversation Engine (Intent: Book New)
    ↓
Greeting + Disclaimer + PII Warning
    ↓
Topic Selection → Topic Taxonomy Mapping → Confirmation
    ↓
Day/Time Preference → Date/Time Parsing (IST)
    ↓
Availability Service → Generate 2 Candidate Slots
    ↓
User Selects Slot → Final Confirmation
    ↓
Generate Booking Code (NL-A742)
    ↓
MCP Tool Calls (Parallel):
    ├─ Calendar MCP → Create Tentative Hold
    ├─ Notes MCP → Append to Pre-Bookings Sheet
    └─ Email MCP → Create Advisor Draft
    ↓
TTS → Read Booking Code + Secure URL
    ↓
Call End
```

### 3.2 Reschedule Flow

```
User Call → STT → Text Input
    ↓
Conversation Engine (Intent: Reschedule)
    ↓
Greeting + Disclaimer + PII Warning
    ↓
Request Booking Code → Validate via Calendar/Notes MCP
    ↓
Collect New Day/Time Preference
    ↓
Availability Service → Generate 2 New Slots
    ↓
User Confirms New Slot
    ↓
MCP Tool Calls:
    ├─ Calendar MCP → Update Hold Time
    ├─ Notes MCP → Append Reschedule Entry
    └─ Email MCP → Create Reschedule Draft
    ↓
TTS → Confirm New Date/Time + Repeat Code
    ↓
Call End
```

### 3.3 Cancel Flow

```
User Call → STT → Text Input
    ↓
Conversation Engine (Intent: Cancel)
    ↓
Greeting + Disclaimer + PII Warning
    ↓
Request Booking Code → Validate via Calendar/Notes MCP
    ↓
MCP Tool Calls:
    ├─ Calendar MCP → Cancel/Mark as Cancelled
    ├─ Notes MCP → Append Cancellation Entry
    └─ Email MCP → Create Cancellation Draft
    ↓
TTS → Confirm Cancellation
    ↓
Call End
```

## 4. Technology Stack

### 4.1 Core Backend
- **Runtime**: Node.js
- **Framework**: Express.js or Fastify
- **Language**: JavaScript/TypeScript
- **Session Management**: In-memory (Phase 1) or Redis (Production)

### 4.2 AI/LLM
- **Primary**: Groq API (fast inference, low latency)
- **Alternatives**: 
  - Claude API (Anthropic)
  - Gemini API (Google)
- **Function Calling**: Enabled for MCP tool integration

### 4.3 Voice Processing
- **STT**: 
  - Google Cloud Speech-to-Text API
  - Alternative: ElevenLabs STT
- **TTS**: 
  - Google Cloud Text-to-Speech API
  - Alternative: ElevenLabs TTS
- **Voice Logger**: File-based logging (txt files)

### 4.4 Telephony (Phase 3+)
- **Option 1**: Twilio Programmable Voice
  - Media Streams for audio
  - WebSocket integration
- **Option 2**: Jambonz (Docker-based)
  - Open-source telephony server
  - WebSocket support
- **Option 3**: AWZ/Awav platform

### 4.5 MCP Servers
- **SDK**: `@modelcontextprotocol/sdk`
- **Calendar**: `@modelcontextprotocol/server-google-calendar`
- **Gmail**: `@modelcontextprotocol/server-gmail`
- **Custom Notes**: Custom MCP server for Google Sheets/Docs

### 4.6 Google Cloud Services
- **Service Account**: JSON key file for authentication
- **APIs Enabled**:
  - Google Calendar API
  - Google Sheets API
  - Google Docs API (optional)
  - Gmail API (or SMTP via Nodemailer)

### 4.7 Testing & Deployment
- **Testing Framework**: Jest or Mocha
- **Web UI (Phase 1)**: Simple text-based chat interface
- **Voice UI (Phase 3)**: Web Audio API for browser testing
- **Deployment**: Streamlit (Phase 3+) or traditional hosting

### 4.8 Additional Tools
- **Date/Time Parsing**: Libraries for IST timezone handling
- **PII Detection**: Regex patterns + heuristics
- **Audio Streaming**: WebSocket (ws package)

## 5. Development Phases

### Phase 1: Core Conversation Engine
**Goal**: Build and test AI conversation logic without telephony complexity.

**Components**:
- ✅ Gemini/Groq/Claude AI integration with function calling
- ✅ All 5 intent handlers (book, reschedule, cancel, prepare, availability)
- ✅ Topic taxonomy and slot filling
- ✅ Dialog state machine
- ✅ Mock availability service
- ✅ Booking code generation
- ✅ Guardrails (PII detection, investment advice refusal)

**Tech Stack**:
- Node.js + Express/Fastify
- Groq AI / Claude API / Gemini API
- In-memory session state

**Testing Interface**: 
- Simple web chat UI (text-based)
- Input: User types messages
- Output: AI responses (text)
- Debug: View function calls, state transitions

**Deliverable**: CLI or web chat where you can test all conversation flows end-to-end.

### Phase 2: MCP Integration
**Goal**: Connect real data sources - calendar, notes, email.

**Components Added**:
- ✅ Google Calendar MCP server (tentative holds)
- ✅ Custom Notes MCP server (Google Sheets append)
- ✅ Gmail MCP server (draft creation)
- ✅ Replace mock calendar with real availability checking

**Tech Stack Additions**:
- `@modelcontextprotocol/sdk`
- `@modelcontextprotocol/server-google-calendar`
- `@modelcontextprotocol/server-gmail`
- Google Cloud service account (JSON key)

**Setup Steps**:
1. Enable APIs (Calendar, Sheet, Gmail)
2. Create Service account, download JSON key
3. Update .env with key location
4. Create sheet and give service account email access
5. Create calendar and give service account email access
6. Gmail → Nodemailer + Gmail SMTP (app passwords)

**Testing**:
- Same chat UI from Phase 1
- Verify actual calendar events created
- Check Google Sheet for logged entries
- View Gmail drafts
- Integration Testing: reschedule, available slots, cancel booking

**Deliverable**: Complete booking flow that creates real calendar events, logs to sheets, and drafts emails.

### Phase 3: Voice Integration
**Goal**: Add speech-to-text, text-to-speech, and telephony.

**Components Added**:
- ✅ Google Speech-to-Text integration
- ✅ Google Text-to-Speech integration
- ✅ Jambonz telephony server (OPTIONAL)
- ✅ WebSocket audio streaming
- ✅ Audio buffer management
- ✅ Voice logger (Store all inputs in txt file)

**Tech Stack Additions**:
- `@google-cloud/speech`
- `@google-cloud/text-to-speech`
- Jambonz (Docker setup) - OPTIONAL
- WebSocket handler (ws package)

**Sub-Phases**:
- **Phase 3a: Web Voice Testing**
  - Build web UI with microphone input
  - Use browser Web Audio API
  - Stream audio to backend → STT → AI → TTS → browser playback
  - Test without real phone calls

**Testing**:
- Click microphone, speak, hear AI response
- Verify audio quality and latency
- Test all conversation flows via voice

**Deliverable**: Working voice interface via web browser.

### Phase 4: Production Deployment
**Goal**: Deploy to production with telephony integration.

**Components**:
- ✅ Telephony integration (Twilio/Jambonz)
- ✅ Production-grade error handling
- ✅ Monitoring and logging
- ✅ Scalability improvements
- ✅ Security hardening

**Deployment**: Streamlit or traditional hosting (AWS, GCP, Azure)

## 6. MCP Tool Schemas

### 6.1 Calendar Tools

#### `event_create_tentative`
```json
{
  "name": "event_create_tentative",
  "description": "Create a tentative advisor appointment or waitlist hold in IST.",
  "parameters": {
    "type": "object",
    "properties": {
      "summary": { "type": "string" },
      "description": { "type": "string" },
      "startDateTime": { 
        "type": "string", 
        "description": "ISO 8601 with timezone Asia/Kolkata" 
      },
      "endDateTime": { "type": "string" },
      "bookingCode": { "type": "string" },
      "isWaitlist": { "type": "boolean" }
    },
    "required": ["summary", "startDateTime", "endDateTime", "bookingCode", "isWaitlist"]
  }
}
```

#### `event_update_time`
```json
{
  "name": "event_update_time",
  "description": "Reschedule an existing advisor hold using its booking code.",
  "parameters": {
    "type": "object",
    "properties": {
      "bookingCode": { "type": "string" },
      "newStartDateTime": { "type": "string" },
      "newEndDateTime": { "type": "string" }
    },
    "required": ["bookingCode", "newStartDateTime", "newEndDateTime"]
  }
}
```

#### `event_cancel`
```json
{
  "name": "event_cancel",
  "description": "Cancel a tentative advisor hold by booking code.",
  "parameters": {
    "type": "object",
    "properties": {
      "bookingCode": { "type": "string" }
    },
    "required": ["bookingCode"]
  }
}
```

#### `calendar_get_availability`
```json
{
  "name": "calendar_get_availability",
  "description": "Get up to two free slots in IST that match a day and time window.",
  "parameters": {
    "type": "object",
    "properties": {
      "preferredDate": { 
        "type": "string", 
        "description": "YYYY-MM-DD in IST" 
      },
      "timeWindow": { 
        "type": "string", 
        "enum": ["morning", "afternoon", "evening", "any"] 
      },
      "slotMinutes": { "type": "number", "default": 30 }
    },
    "required": ["preferredDate", "timeWindow"]
  }
}
```

### 6.2 Notes/Doc Tool

#### `notes_append_prebooking`
```json
{
  "name": "notes_append_prebooking",
  "description": "Append a pre-booking line to the 'Advisor Pre-Bookings' document.",
  "parameters": {
    "type": "object",
    "properties": {
      "createdAt": { "type": "string" },
      "topic": { "type": "string" },
      "slotStart": { "type": "string" },
      "slotEnd": { "type": "string" },
      "bookingCode": { "type": "string" },
      "isWaitlist": { "type": "boolean" },
      "action": { 
        "type": "string", 
        "enum": ["created", "rescheduled", "cancelled"] 
      }
    },
    "required": ["createdAt", "topic", "slotStart", "slotEnd", "bookingCode", "isWaitlist", "action"]
  }
}
```

### 6.3 Email Draft Tool

#### `email_create_advisor_draft`
```json
{
  "name": "email_create_advisor_draft",
  "description": "Create or update an approval-gated email draft to the advisor desk.",
  "parameters": {
    "type": "object",
    "properties": {
      "topic": { "type": "string" },
      "slotStart": { "type": "string" },
      "slotEnd": { "type": "string" },
      "bookingCode": { "type": "string" },
      "isWaitlist": { "type": "boolean" },
      "action": { 
        "type": "string", 
        "enum": ["created", "rescheduled", "cancelled"] 
      }
    },
    "required": ["topic", "bookingCode", "isWaitlist", "action"]
  }
}
```

## 7. Security & Guardrails

### 7.1 PII Protection
- **Detection**: Regex patterns + heuristics to detect phone numbers, emails, account numbers
- **Response**: Immediate interruption with warning message
- **Storage**: PII data is never stored in conversation state
- **Reminder**: Agent reminds users at call start not to share PII

### 7.2 Investment Advice Refusal
- **Detection**: Classifier identifies investment advice requests
- **Response**: Polite refusal with educational resource links
- **Redirect**: Offer to book advisor slot instead

### 7.3 Timezone Handling
- **Standard**: All times in IST (Asia/Kolkata)
- **Format**: ISO 8601 with timezone flag
- **Confirmation**: Always repeat date/time with "IST" suffix
- **Validation**: Ensure all calendar events use IST timezone

### 7.4 Booking Code Security
- **Pattern**: [A-Z]{2}-[A-Z0-9]{3} (e.g., NL-A742)
- **Uniqueness**: Check existing holds before generation
- **Validation**: Verify booking codes before reschedule/cancel operations

## 8. Data Models

### 8.1 Booking Record
```typescript
interface BookingRecord {
  createdAt: string;          // ISO 8601 timestamp in IST
  topic: string;              // One of 5 fixed topics
  slotStart: string;          // ISO 8601 timestamp in IST
  slotEnd: string;            // ISO 8601 timestamp in IST
  bookingCode: string;        // e.g., "NL-A742"
  isWaitlist: boolean;        // true if waitlist entry
  action: "created" | "rescheduled" | "cancelled";
  createdBy: "voice_agent";
}
```

### 8.2 Calendar Event
```typescript
interface CalendarEvent {
  summary: string;             // "Advisor Q&A — {Topic} — {Code}"
  description: string;         // Includes topic, booking code, source
  startDateTime: string;       // ISO 8601 with Asia/Kolkata
  endDateTime: string;         // ISO 8601 with Asia/Kolkata
  bookingCode: string;
  isWaitlist: boolean;
  status: "tentative" | "cancelled";
  metadata: {
    tentative: true;
    source: "voice-prebooking";
  };
}
```

### 8.3 Email Draft
```typescript
interface EmailDraft {
  to: string;                 // advisors@company.com
  subject: string;            // "Tentative Advisor Q&A — {Topic} — {Code}"
  body: string;               // Includes topic, slot, code, waitlist status
  action: "created" | "rescheduled" | "cancelled";
}
```

## 9. Conversation Flows

### 9.1 Shared Building Blocks
- **Greeting**: "Welcome to [Brand] Advisor Desk. This is an automated assistant."
- **Disclaimer**: "This call is for general information only and not investment advice."
- **PII Warning**: "Please do not share your phone number, email address, or account numbers on this call."

### 9.2 Topic Taxonomy
Fixed list of 5 topics (always confirmed explicitly):
1. KYC/Onboarding
2. SIP/Mandates
3. Statements/Tax Docs
4. Withdrawals & Timelines
5. Account Changes/Nominee

### 9.3 Availability Windows
- **Working Days**: Monday to Saturday
- **Working Hours**: 10:00 AM to 6:00 PM IST
- **Slot Duration**: 30 minutes
- **Return Format**: Up to 2 candidate slots per request

## 10. Testing Strategy

### 10.1 Unit Tests
- Intent classification
- Topic taxonomy mapping
- Date/time parsing (IST)
- Booking code generation
- PII detection
- Investment advice detection

### 10.2 Integration Tests
- Book new with clear preference → success
- Book new with vague time → follow-up → success
- Book new with no availability → waitlist flow
- PII attempt → agent refuses
- Investment advice request → refusal
- Reschedule with valid code → success
- Reschedule with invalid code → error handling
- Cancel with valid code → success
- "What to prepare" for each topic
- Check availability for different time windows

### 10.3 End-to-End Tests
- Complete booking flow via text chat (Phase 1)
- Complete booking flow with MCP integration (Phase 2)
- Complete booking flow via voice (Phase 3)
- Verify calendar events created
- Verify sheet entries logged
- Verify email drafts created

## 11. Deployment Architecture

### 11.1 Development Environment
- Local Node.js server
- Mock MCP servers (Phase 1)
- Text-based chat UI

### 11.2 Staging Environment
- Real MCP servers
- Google Cloud service account
- Web voice testing interface

### 11.3 Production Environment
- Telephony integration (Twilio/Jambonz)
- Production MCP servers
- Monitoring and logging
- Scalability considerations

## 12. Monitoring & Logging

### 12.1 Voice Logger
- Store all voice inputs in text files
- Timestamp each interaction
- Include intent, slots, and tool calls

### 12.2 Error Logging
- MCP tool failures
- Audio processing errors
- Conversation state errors

### 12.3 Analytics
- Booking success rate
- Average call duration
- Intent distribution
- Waitlist conversion rate

## 13. Future Enhancements

### Non-Goals for Current Milestone
- ❌ Reminders (SMS/email)
- ❌ Advisor confirmation workflow
- ❌ User notifications beyond booking code
- ❌ PII collection (contact details via secure link only)

### Potential Future Features
- Multi-language support
- SMS notifications
- Advisor dashboard
- Analytics dashboard
- Integration with CRM systems

