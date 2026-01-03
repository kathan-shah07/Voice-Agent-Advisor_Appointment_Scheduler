/**
 * Core Conversation Engine
 * Orchestrates the entire conversation flow
 */

import { DialogStateManager, DIALOG_STATES } from './dialogState.js';
import { INTENTS, SYSTEM_MESSAGES, PREPARATION_GUIDES, TIME_WINDOW_RANGES } from '../config/constants.js';
import { classifyIntent, extractSlots, interpretDateTimeWithLLM } from '../services/aiService.js';
import { detectPII, detectInvestmentAdvice } from '../utils/guardrails.js';
import { mapToTopic, isValidTopic } from '../utils/topicMapper.js';
import { getAvailableSlots, parseDateTimePreference, formatSlot, checkSlotOverlap } from '../services/availabilityService.js';
import { generateBookingCode, formatBookingCodeForVoice } from '../utils/bookingCode.js';
import { logger } from '../utils/logger.js';
import { format, addDays, getDay } from 'date-fns';
import { utcToZonedTime, zonedTimeToUtc } from 'date-fns-tz';
import { formatIST24Hour, getCurrentIST } from '../utils/timezone.js';
import { GmailCalendarMCPClient } from '../services/mcp/gmailCalendarMCPClient.js';
import { GoogleSheetsMCPClient } from '../services/mcp/googleSheetsMCPClient.js';

// In-memory storage for bookings
const mockBookings = new Map(); // bookingCode -> booking data
const existingCodes = new Set();
// Map to store booking code -> calendar event ID for reschedule/cancel operations
const bookingCodeToEventId = new Map(); // bookingCode -> eventId

/**
 * Conversation Engine
 */
export class ConversationEngine {
  constructor(brandName = 'Advisor Desk', secureUrl = 'https://advisors.example.com/complete') {
    this.brandName = brandName;
    this.secureUrl = secureUrl;
    this.sessions = new Map(); // sessionId -> DialogStateManager
    this.mcpClient = null;
    this.mcpInitialized = false;
    this.sheetsClient = null;
    this.sheetsInitialized = false;
    // Initialize MCP clients asynchronously (don't await in constructor)
    this.initializeMCP().catch(err => {
      logger.log('error', `Failed to initialize MCP client: ${err.message}`, {});
    });
    this.initializeSheets().catch(err => {
      logger.log('error', `Failed to initialize Sheets client: ${err.message}`, {});
    });
  }

  /**
   * Initialize MCP client
   */
  async initializeMCP() {
    try {
      this.mcpClient = new GmailCalendarMCPClient();
      await this.mcpClient.initialize();
      this.mcpInitialized = true;
      logger.log('mcp', 'MCP client initialized in conversation engine', {});
    } catch (error) {
      logger.log('error', `Failed to initialize MCP client: ${error.message}`, {});
      // Continue in mock mode if MCP fails
      this.mcpClient = null;
      this.mcpInitialized = false;
    }
  }

  /**
   * Initialize Google Sheets MCP client
   */
  async initializeSheets() {
    try {
      this.sheetsClient = new GoogleSheetsMCPClient();
      await this.sheetsClient.initialize();
      this.sheetsInitialized = this.sheetsClient.isAvailable();
      logger.log('mcp', 'Google Sheets MCP client initialized in conversation engine', {
        spreadsheetId: this.sheetsClient.getSpreadsheetId() || 'not configured',
        sheetName: this.sheetsClient.getSheetName()
      });
    } catch (error) {
      logger.log('error', `Failed to initialize Sheets MCP client: ${error.message}`, {});
      this.sheetsClient = null;
      this.sheetsInitialized = false;
    }
  }

  /**
   * Get or create session
   */
  getSession(sessionId) {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, new DialogStateManager(sessionId));
    }
    return this.sessions.get(sessionId);
  }

  /**
   * Execute tool calls (real MCP or mock mode)
   * @private
   */
  async executeToolCalls(toolCallConfigs) {
    const results = [];
    const toolCalls = [];
    const mcpEnabled = process.env.ENABLE_MCP === 'true';

    for (const config of toolCallConfigs) {
      const { name, params } = config;
      let result;

      try {
        // Check if this is a calendar/event/email tool that can use MCP
        const calendarTools = ['event_create_tentative', 'event_update_time', 'event_cancel', 'calendar_get_availability'];
        const emailTools = ['email_create_advisor_draft'];
        const sheetsTools = ['notes_append_prebooking'];
        const mcpTools = [...calendarTools, ...emailTools];
        const useMCP = mcpEnabled && this.mcpInitialized && this.mcpClient && this.mcpClient.isAvailable() && mcpTools.includes(name);
        const useSheets = mcpEnabled && this.sheetsInitialized && this.sheetsClient && this.sheetsClient.isAvailable() && sheetsTools.includes(name);

        if (useMCP) {
          // Use real MCP client - no fallback, fail if MCP fails
          const mcpResult = await this.mcpClient.executeTool(name, params);
          result = { 
            success: true, 
            mock: false, 
            function: { name, arguments: JSON.stringify(params) },
            data: mcpResult
          };
          logger.log('mcp', `MCP tool executed successfully: ${name}`, { params, result: mcpResult });
        } else if (useSheets) {
          // Use Google Sheets MCP client for notes
          const sheetsResult = await this.sheetsClient.executeTool(name, params);
          result = {
            success: true,
            mock: false,
            function: { name, arguments: JSON.stringify(params) },
            data: sheetsResult
          };
          logger.log('mcp', `Sheets MCP tool executed successfully: ${name}`, { params, result: sheetsResult });
        } else {
          // Mock mode - only when MCP is explicitly disabled
          result = { success: true, mock: true, function: { name, arguments: JSON.stringify(params) } };
        }

        // Format result for logging
        toolCalls.push({
          function: {
            name,
            arguments: JSON.stringify(params)
          },
          result: result.success ? 'success' : 'error',
          mock: result.mock || false
        });

        results.push(result);
      } catch (error) {
        logger.log('tool_error', `Tool call failed: ${name}`, {
          error: error.message,
          params
        });
        results.push({ success: false, error: error.message });
        toolCalls.push({
          function: {
            name,
            arguments: JSON.stringify(params)
          },
          result: 'error',
          error: error.message
        });
      }
    }

    return { toolCalls, results };
  }

  /**
   * Process user input and generate response
   */
  async processInput(sessionId, userInput) {
    const session = this.getSession(sessionId);
    const state = session.getState();

    logger.log('system', `Processing user input`, { sessionId: session.sessionId, userInput, state, timestamp: new Date().toISOString() });

    // Check guardrails first
    const piiCheck = detectPII(userInput);
    if (piiCheck.detected) {
      logger.log('system', `PII detected and blocked`, { sessionId: session.sessionId, piiType: piiCheck.type });
      session.addMessage('user', '[REDACTED - PII detected]');
      return {
        response: SYSTEM_MESSAGES.PII_DETECTED,
        state: session.getState(),
        intent: session.getIntent(),
        slots: session.getSlots(),
        toolCalls: []
      };
    }

    if (detectInvestmentAdvice(userInput)) {
      session.addMessage('user', userInput);
      return {
        response: SYSTEM_MESSAGES.INVESTMENT_ADVICE_REFUSAL,
        state: session.getState(),
        intent: session.getIntent(),
        slots: session.getSlots(),
        toolCalls: []
      };
    }

    // Add user message to history
    session.addMessage('user', userInput);

    // Handle initial state - send greeting
    if (state === DIALOG_STATES.INITIAL) {
      return await this.handleInitial(session);
    }

    // Handle COMPLETED state - allow new intents after booking completion
    if (state === DIALOG_STATES.COMPLETED) {
      // Preserve booking code if it exists for potential cancel/reschedule
      const existingBookingCode = session.getSlots().booking_code_generated || session.getSlots().booking_code;
      
      // Reset intent to allow new intent classification
      session.setIntent(null);
      session.transitionTo(DIALOG_STATES.GREETING);
      
      // Preserve booking code in slots for future use
      if (existingBookingCode) {
        session.updateSlots({ booking_code: existingBookingCode });
      }
      
      // Now proceed with normal intent classification
      // (will fall through to intent classification logic below)
    }

    // Check if user wants to book from availability check
    if (state === DIALOG_STATES.AVAILABILITY_CHECK) {
      const lowerInput = userInput.toLowerCase();
      if (lowerInput.includes('book') || lowerInput.includes('yes') || lowerInput.match(/book\s*(slot\s*)?[12]/i)) {
        // Switch to book_new intent
        session.setIntent(INTENTS.BOOK_NEW);
        // Extract slot number if provided
        const slotMatch = userInput.match(/[12]|(slot\s*)?[12]/i);
        if (slotMatch) {
          const slotNum = slotMatch[0].replace(/\D/g, '');
          const availableSlots = session.getSlots().available_slots || [];
          if (availableSlots.length > 0 && slotNum) {
            const slotIndex = parseInt(slotNum) - 1;
            if (slotIndex >= 0 && slotIndex < availableSlots.length) {
              session.updateSlots({ 
                selected_slot: availableSlots[slotIndex],
                topic: null // Will need to ask for topic
              });
              session.transitionTo(DIALOG_STATES.TOPIC_SELECTION);
              const response = `Great! I'll book that slot for you. First, which topic would you like to discuss? You can choose from: KYC/Onboarding, SIP/Mandates, Statements and Tax Documents, Withdrawals and Timelines, or Account Changes and Nominee.`;
              session.addMessage('assistant', response);
              return {
                response,
                state: session.getState(),
                intent: session.getIntent(),
                slots: session.getSlots(),
                toolCalls: []
              };
            }
          }
        }
        // If no slot number, ask for topic first
        session.transitionTo(DIALOG_STATES.TOPIC_SELECTION);
        const response = `Great! Which topic would you like to discuss? You can choose from: KYC/Onboarding, SIP/Mandates, Statements and Tax Documents, Withdrawals and Timelines, or Account Changes and Nominee.`;
        session.addMessage('assistant', response);
        return {
          response,
          state: session.getState(),
          intent: session.getIntent(),
          slots: session.getSlots(),
          toolCalls: []
        };
      }
    }

    // STEP 1: Always classify intent first for ANY query (if not already set)
    if (!session.getIntent() && state !== DIALOG_STATES.INTENT_CONFIRMATION) {
      logger.log('intent', `Classifying intent from user input`, { sessionId: session.sessionId, userInput });
      const intent = await classifyIntent(userInput);
      session.setIntent(intent);
      logger.log('intent', `Intent classified: ${intent}`, { sessionId: session.sessionId, intent });
      
      // Move to intent confirmation state
      session.transitionTo(DIALOG_STATES.INTENT_CONFIRMATION);
      
      // Get intent display name
      const intentNames = {
        [INTENTS.BOOK_NEW]: 'book a new appointment',
        [INTENTS.RESCHEDULE]: 'reschedule an appointment',
        [INTENTS.CANCEL]: 'cancel an appointment',
        [INTENTS.WHAT_TO_PREPARE]: 'know what to prepare',
        [INTENTS.CHECK_AVAILABILITY]: 'check availability'
      };
      
      const response = `I understand you want to ${intentNames[intent] || 'book an appointment'}. Is that correct?`;
      session.addMessage('assistant', response);
      return {
        response,
        state: session.getState(),
        intent: session.getIntent(),
        slots: session.getSlots(),
        toolCalls: []
      };
    }

    // STEP 2: Handle intent confirmation
    if (state === DIALOG_STATES.INTENT_CONFIRMATION) {
      const lowerInput = userInput.toLowerCase();
      if (lowerInput.includes('yes') || lowerInput.includes('correct') || lowerInput.includes('right') || lowerInput.includes('that\'s right')) {
        // Intent confirmed, proceed to appropriate handler
        const confirmedIntent = session.getIntent();
        logger.log('intent', `Intent confirmed: ${confirmedIntent}`, { sessionId: session.sessionId, intent: confirmedIntent });
        
        // Route to appropriate handler based on confirmed intent
        switch (confirmedIntent) {
          case INTENTS.BOOK_NEW:
            return await this.handleBookNew(session, userInput);
          case INTENTS.RESCHEDULE:
            return await this.handleReschedule(session, userInput);
          case INTENTS.CANCEL:
            return await this.handleCancel(session, userInput);
          case INTENTS.WHAT_TO_PREPARE:
            return await this.handleWhatToPrepare(session, userInput);
          case INTENTS.CHECK_AVAILABILITY:
            return await this.handleCheckAvailability(session, userInput);
          default:
            return {
              response: "I'm not sure how to help with that. Would you like to book an advisor appointment?",
              state: session.getState(),
              intent: session.getIntent(),
              slots: session.getSlots(),
              toolCalls: []
            };
        }
      } else if (lowerInput.includes('no') || lowerInput.includes('wrong') || lowerInput.includes('incorrect')) {
        // Intent incorrect, re-classify
        session.setIntent(null);
        session.transitionTo(DIALOG_STATES.GREETING);
        const response = `I apologize for the confusion. How can the advisor help you? You can choose from: book a new appointment, reschedule an appointment, cancel an appointment, know what to prepare, or check availability.`;
        session.addMessage('assistant', response);
        return {
          response,
          state: session.getState(),
          intent: null,
          slots: session.getSlots(),
          toolCalls: []
        };
      } else {
        // Unclear response, ask again
        const intentNames = {
          [INTENTS.BOOK_NEW]: 'book a new appointment',
          [INTENTS.RESCHEDULE]: 'reschedule an appointment',
          [INTENTS.CANCEL]: 'cancel an appointment',
          [INTENTS.WHAT_TO_PREPARE]: 'know what to prepare',
          [INTENTS.CHECK_AVAILABILITY]: 'check availability'
        };
        const response = `Just to confirm, you want to ${intentNames[session.getIntent()] || 'book an appointment'}. Is that correct? (Please say yes or no)`;
        session.addMessage('assistant', response);
        return {
          response,
          state: session.getState(),
          intent: session.getIntent(),
          slots: session.getSlots(),
          toolCalls: []
        };
      }
    }

    // STEP 3: Route to appropriate handler if intent is already confirmed
    switch (session.getIntent()) {
      case INTENTS.BOOK_NEW:
        return await this.handleBookNew(session, userInput);
      case INTENTS.RESCHEDULE:
        return await this.handleReschedule(session, userInput);
      case INTENTS.CANCEL:
        return await this.handleCancel(session, userInput);
      case INTENTS.WHAT_TO_PREPARE:
        return await this.handleWhatToPrepare(session, userInput);
      case INTENTS.CHECK_AVAILABILITY:
        return await this.handleCheckAvailability(session, userInput);
      default:
        return {
          response: "I'm not sure how to help with that. Would you like to book an advisor appointment?",
          state: session.getState(),
          intent: session.getIntent(),
          slots: session.getSlots(),
          toolCalls: []
        };
    }
  }

  /**
   * Handle initial state
   */
  async handleInitial(session) {
    const greeting = SYSTEM_MESSAGES.GREETING(this.brandName);
    const disclaimer = SYSTEM_MESSAGES.DISCLAIMER;
    const piiWarning = SYSTEM_MESSAGES.PII_WARNING;

    session.context.greeting_sent = true;
    session.context.disclaimer_sent = true;
    session.context.pii_warning_sent = true;
    session.transitionTo(DIALOG_STATES.GREETING);

    const response = `${greeting} ${disclaimer} ${piiWarning}\n\nHow can the advisor help you? You can choose from: ${Object.values(INTENTS).map(i => i.replace('_', ' ')).join(', ')}.`;

    session.addMessage('assistant', response);

    return {
      response,
      state: session.getState(),
      intent: null,
      slots: session.getSlots(),
      toolCalls: []
    };
  }

  /**
   * Handle book new intent
   */
  async handleBookNew(session, userInput) {
    const state = session.getState();
    const slots = session.getSlots();

    // Directly trigger book new flow - start with topic selection
    // When coming from INTENT_CONFIRMATION, immediately ask for topic
    if (state === DIALOG_STATES.INTENT_CONFIRMATION) {
      // As per req.txt: "How can the advisor help you? You can choose from: KYC/Onboarding, SIP/Mandates, Statements and Tax Documents, Withdrawals and Timelines, or Account Changes and Nominee."
      const response = `How can the advisor help you? You can choose from: KYC/Onboarding, SIP/Mandates, Statements and Tax Documents, Withdrawals and Timelines, or Account Changes and Nominee.`;
      session.transitionTo(DIALOG_STATES.TOPIC_SELECTION);
      session.addMessage('assistant', response);
      return {
        response,
        state: session.getState(),
        intent: session.getIntent(),
        slots: session.getSlots(),
        toolCalls: []
      };
    }

    // Topic selection
    if (state === DIALOG_STATES.GREETING || state === DIALOG_STATES.TOPIC_SELECTION) {
      const extractedSlots = await extractSlots(userInput, INTENTS.BOOK_NEW);
      let topic = extractedSlots.topic || mapToTopic(userInput);

      if (topic && isValidTopic(topic)) {
        session.updateSlots({ topic });
        session.transitionTo(DIALOG_STATES.TOPIC_CONFIRMATION);
        const response = `You chose ${topic}. Is that correct?`;
        session.addMessage('assistant', response);
        return {
          response,
          state: session.getState(),
          intent: session.getIntent(),
          slots: session.getSlots(),
          toolCalls: []
        };
      } else {
        const response = `How can the advisor help you? You can choose from: KYC/Onboarding, SIP/Mandates, Statements and Tax Documents, Withdrawals and Timelines, or Account Changes and Nominee.`;
        session.transitionTo(DIALOG_STATES.TOPIC_SELECTION);
        session.addMessage('assistant', response);
        return {
          response,
          state: session.getState(),
          intent: session.getIntent(),
          slots: session.getSlots(),
          toolCalls: []
        };
      }
    }

    // Topic confirmation
    if (state === DIALOG_STATES.TOPIC_CONFIRMATION) {
      const lowerInput = userInput.toLowerCase();
      if (lowerInput.includes('yes') || lowerInput.includes('correct') || lowerInput.includes('right')) {
        session.transitionTo(DIALOG_STATES.TIME_PREFERENCE);
        const response = `Which day and time works best? You can say things like 'tomorrow afternoon' or 'Monday after 4 PM'.`;
        session.addMessage('assistant', response);
        return {
          response,
          state: session.getState(),
          intent: session.getIntent(),
          slots: session.getSlots(),
          toolCalls: []
        };
      } else {
        session.transitionTo(DIALOG_STATES.TOPIC_SELECTION);
        const response = `How can the advisor help you? You can choose from: KYC/Onboarding, SIP/Mandates, Statements and Tax Documents, Withdrawals and Timelines, or Account Changes and Nominee.`;
        session.addMessage('assistant', response);
        return {
          response,
          state: session.getState(),
          intent: session.getIntent(),
          slots: session.getSlots(),
          toolCalls: []
        };
      }
    }

    // Time preference
    if (state === DIALOG_STATES.TIME_PREFERENCE) {
      const extractedSlots = await extractSlots(userInput, INTENTS.BOOK_NEW);
      let dateTimePref = parseDateTimePreference(userInput || extractedSlots.preferred_day + ' ' + extractedSlots.preferred_time_window);
      
      // Check if weekend was requested - decline gracefully
      if (dateTimePref.requestedWeekend || dateTimePref.isWeekend) {
        const response = `I understand you'd like to schedule for a weekend, but our advisor slots are only available Monday through Friday (10 AM to 6 PM IST). Could you please provide a weekday preference? For example, you could say "Monday afternoon" or "Tuesday morning".`;
        session.addMessage('assistant', response);
        return {
          response,
          state: session.getState(),
          intent: session.getIntent(),
          slots: session.getSlots(),
          toolCalls: []
        };
      }
      
      // If standard parser didn't find date/time, try LLM interpretation
      if (!dateTimePref.date || !dateTimePref.timeWindow) {
        logger.log('llm', 'Standard parser unclear, trying LLM interpretation', { userInput });
        const llmInterpretation = await interpretDateTimeWithLLM(userInput);
        
        if (llmInterpretation.date && llmInterpretation.timeWindow && llmInterpretation.confidence > 0.5) {
          // Check if LLM detected weekend
          if (llmInterpretation.requestedWeekend || llmInterpretation.isWeekend) {
            const response = `I understand you'd like to schedule for a weekend, but our advisor slots are only available Monday through Friday (10 AM to 6 PM IST). Could you please provide a weekday preference? For example, you could say "Monday afternoon" or "Tuesday morning".`;
            session.addMessage('assistant', response);
            return {
              response,
              state: session.getState(),
              intent: session.getIntent(),
              slots: session.getSlots(),
              toolCalls: []
            };
          }
          
          // Use LLM interpretation - need to convert date string to Date object
          let parsedDate = null;
          if (llmInterpretation.date) {
            const today = new Date();
            const istToday = utcToZonedTime(today, 'Asia/Kolkata');
            
            if (llmInterpretation.date.toLowerCase() === 'today') {
              parsedDate = today;
            } else if (llmInterpretation.date.toLowerCase() === 'tomorrow') {
              parsedDate = addDays(today, 1);
            } else if (llmInterpretation.date.toLowerCase().startsWith('next ')) {
              // Handle "next Monday" etc.
              const dayMatch = llmInterpretation.date.match(/next\s+(monday|tuesday|wednesday|thursday|friday)/i);
              if (dayMatch) {
                const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
                const targetDay = dayNames.indexOf(dayMatch[1].toLowerCase());
                if (targetDay > 0 && targetDay < 6) { // Only weekdays
                  const currentDay = getDay(istToday);
                  const daysUntil = (targetDay - currentDay + 7) % 7 || 7;
                  parsedDate = addDays(today, daysUntil);
                }
              }
            } else {
              // Try to parse as ISO date or use parseDateTimePreference
              const fallbackParse = parseDateTimePreference(llmInterpretation.date);
              if (fallbackParse.date) {
                parsedDate = fallbackParse.date;
              } else {
                parsedDate = new Date(llmInterpretation.date);
                if (isNaN(parsedDate.getTime())) {
                  parsedDate = null;
                }
              }
            }
          }
          
          if (parsedDate) {
            // Check if parsed date falls on weekend
            const parsedIST = utcToZonedTime(parsedDate, 'Asia/Kolkata');
            const dayOfWeek = getDay(parsedIST);
            const isWeekendDate = dayOfWeek === 0 || dayOfWeek === 6;
            
            if (isWeekendDate) {
              const response = `I understand you'd like to schedule for a weekend, but our advisor slots are only available Monday through Friday (10 AM to 6 PM IST). Could you please provide a weekday preference? For example, you could say "Monday afternoon" or "Tuesday morning".`;
              session.addMessage('assistant', response);
              return {
                response,
                state: session.getState(),
                intent: session.getIntent(),
                slots: session.getSlots(),
                toolCalls: []
              };
            }
            
            dateTimePref = {
              date: parsedDate,
              timeWindow: llmInterpretation.timeWindow,
              specificTime: null,
              isWeekend: false,
              requestedWeekend: false
            };
            logger.log('llm', 'Using LLM interpretation for date/time', { 
              original: userInput, 
              interpreted: dateTimePref,
              confidence: llmInterpretation.confidence 
            });
          } else if (llmInterpretation.needsClarification) {
            const response = `I want to make sure I understand your preferred date and time correctly. ${llmInterpretation.interpretation || 'Could you please provide a specific weekday and time preference? For example, "Monday afternoon" or "Tuesday at 3 PM".'}`;
            session.addMessage('assistant', response);
            return {
              response,
              state: session.getState(),
              intent: session.getIntent(),
              slots: session.getSlots(),
              toolCalls: []
            };
          }
        } else if (llmInterpretation.needsClarification) {
          const response = `I want to make sure I understand your preferred date and time correctly. Could you please provide a specific weekday and time preference? For example, "Monday afternoon" or "Tuesday at 3 PM".`;
          session.addMessage('assistant', response);
          return {
            response,
            state: session.getState(),
            intent: session.getIntent(),
            slots: session.getSlots(),
            toolCalls: []
          };
        }
      }
      
      if (dateTimePref.date && dateTimePref.timeWindow) {
        session.updateSlots({
          preferred_day: dateTimePref.date,
          preferred_time_window: dateTimePref.timeWindow
        });

        // FIRST: Check real-time calendar availability
        // Get existing bookings from both mock storage and real calendar
        const existingBookings = Array.from(mockBookings.values());
        
        // Get real-time available slots from calendar
        const availableSlots = await getAvailableSlots(
          dateTimePref.date,
          dateTimePref.timeWindow,
          30,
          existingBookings
        );

        // If we have available slots, offer them
        if (availableSlots.length > 0) {
          // Offer only valid, available slots
          session.updateSlots({ available_slots: availableSlots });
          session.transitionTo(DIALOG_STATES.SLOT_OFFER);

          // Format as per req.txt: "I have two options on [date]: 3:00 PM to 3:30 PM IST, 4:30 PM to 5:00 PM IST"
          const istStart = utcToZonedTime(availableSlots[0].start, 'Asia/Kolkata');
          const dateStr = format(istStart, 'd MMMM');
          
          const slotTimes = availableSlots.map(slot => {
            const istSlotStart = utcToZonedTime(slot.start, 'Asia/Kolkata');
            const istSlotEnd = utcToZonedTime(slot.end, 'Asia/Kolkata');
            return `${format(istSlotStart, 'h:mm a')} to ${format(istSlotEnd, 'h:mm a')} IST`;
          }).join('\n');

          const response = `I have ${availableSlots.length} option${availableSlots.length > 1 ? 's' : ''} on ${dateStr}:\n${slotTimes}\nWhich do you prefer, 1 or ${availableSlots.length}?`;
          session.addMessage('assistant', response);
          return {
            response,
            state: session.getState(),
            intent: session.getIntent(),
            slots: session.getSlots(),
            toolCalls: []
          };
        }

        // NO AVAILABLE SLOTS: Check if user specified a specific time that overlaps
        // Parse user input for specific time preference
        const userInputLower = userInput.toLowerCase();
        const hasSpecificTime = userInputLower.includes('at') || 
                                userInputLower.match(/\d+\s*(am|pm|:)/i) ||
                                userInputLower.match(/\b(10|11|12|1|2|3|4|5|6)\s*(am|pm|o'clock)/i);
        
        if (hasSpecificTime || availableSlots.length === 0) {
          // User wants a specific time or no slots available - check for overlap and offer waitlist
          const windowRange = TIME_WINDOW_RANGES[dateTimePref.timeWindow] || TIME_WINDOW_RANGES.any;
          const preferredHour = windowRange.start;
          
          // Create preferred slot time in IST, then convert to UTC
          const istDate = utcToZonedTime(dateTimePref.date, 'Asia/Kolkata');
          const preferredSlotStartIST = new Date(istDate);
          preferredSlotStartIST.setHours(preferredHour, 0, 0, 0);
          const preferredSlotEndIST = new Date(preferredSlotStartIST);
          preferredSlotEndIST.setMinutes(preferredSlotEndIST.getMinutes() + 30);
          
          // Convert to UTC for comparison
          const preferredSlotStartUTC = zonedTimeToUtc(preferredSlotStartIST, 'Asia/Kolkata');
          const preferredSlotEndUTC = zonedTimeToUtc(preferredSlotEndIST, 'Asia/Kolkata');
          
          // Check for overlap with existing bookings
          const overlapCheck = checkSlotOverlap(preferredSlotStartUTC, preferredSlotEndUTC, existingBookings);
          
          // If there's an overlap or no slots, offer waitlist
          if (overlapCheck.hasOverlap || availableSlots.length === 0) {
            // Store preferred slot for waitlist
            session.updateSlots({ 
              preferred_slot_start: preferredSlotStartUTC.toISOString(),
              preferred_slot_end: preferredSlotEndUTC.toISOString()
            });
            session.transitionTo(DIALOG_STATES.WAITLIST_CONFIRMATION);
            
            const preferredTimeIST = utcToZonedTime(preferredSlotStartUTC, 'Asia/Kolkata');
            const timeStr = format(preferredTimeIST, 'h:mm a');
            const dateStr = format(preferredTimeIST, 'EEEE, d MMMM');
            
            let response;
            if (overlapCheck.hasOverlap) {
              response = `I see that ${dateStr} at ${timeStr} IST is already booked. I can add you to a waitlist for that time slot, and the team will contact you if it becomes available. Would you like to be added to the waitlist?`;
            } else {
              response = `I don't have any available slots in that time window on ${dateStr}. I can add you to a waitlist, and the team will contact you with available options. Would you like to be added to the waitlist?`;
            }
            
            session.addMessage('assistant', response);
            return {
              response,
              state: session.getState(),
              intent: session.getIntent(),
              slots: session.getSlots(),
              toolCalls: []
            };
          }
        }

        // Fallback: No slots and no specific preference - offer waitlist
        if (availableSlots.length === 0) {
          // No slots available at all - waitlist flow
          const bookingCode = generateBookingCode(existingCodes);
          existingCodes.add(bookingCode);
          session.updateSlots({ booking_code_generated: bookingCode });

          // Execute tool calls for waitlist
          const toolCallConfigs = [
            {
              name: 'event_create_tentative',
              params: {
                summary: `Advisor Q&A — ${slots.topic} — ${bookingCode}`,
                description: `Tentative waitlist hold created via voice agent for ${slots.topic}.`,
                startDateTime: dateTimePref.date.toISOString(),
                endDateTime: new Date(dateTimePref.date.getTime() + 30 * 60000).toISOString(),
                bookingCode,
                isWaitlist: true
              }
            },
            {
              name: 'notes_append_prebooking',
              params: {
                createdAt: new Date().toISOString(),
                topic: slots.topic,
                slotStart: dateTimePref.date.toISOString(),
                slotEnd: new Date(dateTimePref.date.getTime() + 30 * 60000).toISOString(),
                bookingCode,
                isWaitlist: true,
                action: 'created'
              }
            },
            {
              name: 'email_create_advisor_draft',
              params: {
                topic: slots.topic,
                slotStart: dateTimePref.date.toISOString(),
                slotEnd: new Date(dateTimePref.date.getTime() + 30 * 60000).toISOString(),
                bookingCode,
                isWaitlist: true,
                action: 'created'
              }
            }
          ];

          const { toolCalls, results } = await this.executeToolCalls(toolCallConfigs);

          logger.log('tool_call', `Tool calls executed: ${toolCalls.map(t => t.function.name).join(', ')}`, { 
            sessionId: session.sessionId, 
            toolCalls: toolCalls.map(t => t.function.name),
            bookingCode,
            results: results.map(r => ({ success: r.success, mock: r.mock }))
          });

          const response = `There are no matching advisor slots in that window. I can place you on a waitlist and the team will contact you with options. Your booking code is ${bookingCode}. ${SYSTEM_MESSAGES.SECURE_URL(this.secureUrl)}\n\nIs there anything else I can help you with? You can reschedule, cancel, check what to prepare, or ask about availability.`;
          
          // Store booking code in slots for future cancel/reschedule operations
          session.updateSlots({ booking_code: bookingCode, booking_code_generated: bookingCode });
          session.transitionTo(DIALOG_STATES.COMPLETED);
          session.addMessage('assistant', response);
          return {
            response,
            state: session.getState(),
            intent: session.getIntent(),
            slots: session.getSlots(),
            toolCalls
          };
        }

        // Offer slots
        session.updateSlots({ available_slots: availableSlots });
        session.transitionTo(DIALOG_STATES.SLOT_OFFER);

        // Format as per req.txt: "I have two options on [date]: 3:00 PM to 3:30 PM IST, 4:30 PM to 5:00 PM IST"
        const istStart = utcToZonedTime(availableSlots[0].start, 'Asia/Kolkata');
        const dateStr = format(istStart, 'd MMMM');
        
        const slotTimes = availableSlots.map(slot => {
          const istSlotStart = utcToZonedTime(slot.start, 'Asia/Kolkata');
          const istSlotEnd = utcToZonedTime(slot.end, 'Asia/Kolkata');
          return `${format(istSlotStart, 'h:mm a')} to ${format(istSlotEnd, 'h:mm a')} IST`;
        }).join('\n');

        const response = `I have ${availableSlots.length} option${availableSlots.length > 1 ? 's' : ''} on ${dateStr}:\n${slotTimes}\n\nYou can say "1" or "2", "first" or "second", or describe the time like "3 PM" or "morning". Which would you prefer?`;
        session.addMessage('assistant', response);
        return {
          response,
          state: session.getState(),
          intent: session.getIntent(),
          slots: session.getSlots(),
          toolCalls: []
        };
      } else {
        const response = `Is there a better time of day for you, like morning between 10 and 12, afternoon, or early evening?`;
        session.addMessage('assistant', response);
        return {
          response,
          state: session.getState(),
          intent: session.getIntent(),
          slots: session.getSlots(),
          toolCalls: []
        };
      }
    }

    // Waitlist confirmation
    if (state === DIALOG_STATES.WAITLIST_CONFIRMATION) {
      const lowerInput = userInput.toLowerCase();
      if (lowerInput.includes('yes') || lowerInput.includes('add') || lowerInput.includes('please') || lowerInput.includes('ok')) {
        // User confirmed waitlist
        const bookingCode = generateBookingCode(existingCodes);
        existingCodes.add(bookingCode);
        session.updateSlots({ booking_code_generated: bookingCode });

        // Get preferred slot times from slots (set during overlap detection)
        const preferredStart = slots.preferred_slot_start ? new Date(slots.preferred_slot_start) : (slots.preferred_day ? new Date(slots.preferred_day) : new Date());
        const preferredEnd = slots.preferred_slot_end ? new Date(slots.preferred_slot_end) : new Date(preferredStart.getTime() + 30 * 60000);

        // Execute tool calls for waitlist
        const toolCallConfigs = [
          {
            name: 'event_create_tentative',
            params: {
              summary: `Advisor Q&A — ${slots.topic} — ${bookingCode}`,
              description: `Tentative waitlist hold created via voice agent for ${slots.topic}.`,
              startDateTime: preferredStart.toISOString(),
              endDateTime: preferredEnd.toISOString(),
              bookingCode,
              isWaitlist: true
            }
          },
          {
            name: 'notes_append_prebooking',
            params: {
              createdAt: new Date().toISOString(),
              topic: slots.topic,
              slotStart: preferredStart.toISOString(),
              slotEnd: preferredEnd.toISOString(),
              bookingCode,
              isWaitlist: true,
              action: 'created'
            }
          },
          {
            name: 'email_create_advisor_draft',
            params: {
              topic: slots.topic,
              slotStart: preferredStart.toISOString(),
              slotEnd: preferredEnd.toISOString(),
              bookingCode,
              isWaitlist: true,
              action: 'created'
            }
          }
        ];

        const { toolCalls, results } = await this.executeToolCalls(toolCallConfigs);

        logger.log('tool_call', `Waitlist tool calls executed: ${toolCalls.map(t => t.function.name).join(', ')}`, { 
          sessionId: session.sessionId, 
          toolCalls: toolCalls.map(t => t.function.name),
          bookingCode,
          results: results.map(r => ({ success: r.success, mock: r.mock }))
        });

        const response = `I've added you to the waitlist for that time slot. Your booking code is ${bookingCode}. ${SYSTEM_MESSAGES.SECURE_URL(this.secureUrl)}\n\nThe advisor team will contact you if the slot becomes available. Is there anything else I can help you with?`;
        
        session.updateSlots({ booking_code: bookingCode, booking_code_generated: bookingCode });
        session.transitionTo(DIALOG_STATES.COMPLETED);
        session.addMessage('assistant', response);
        return {
          response,
          state: session.getState(),
          intent: session.getIntent(),
          slots: session.getSlots(),
          toolCalls
        };
      } else {
        // User declined waitlist
        const response = `No problem. Would you like to check availability for a different time? You can say "tomorrow", "this week", or a specific day and time.`;
        session.transitionTo(DIALOG_STATES.TIME_PREFERENCE);
        session.addMessage('assistant', response);
        return {
          response,
          state: session.getState(),
          intent: session.getIntent(),
          slots: session.getSlots(),
          toolCalls: []
        };
      }
    }

    // Slot selection with natural language support
    if (state === DIALOG_STATES.SLOT_OFFER) {
      const availableSlots = slots.available_slots || [];
      const normalizedInput = userInput.toLowerCase().trim();
      
      let slotIndex = -1;
      
      // Try numeric selection first (1, 2, first, second)
      const numericMatch = normalizedInput.match(/(\d+)|(first|one)|(second|two)/);
      if (numericMatch) {
        if (numericMatch[1]) {
          slotIndex = parseInt(numericMatch[1], 10) - 1;
        } else if (numericMatch[2]) {
          slotIndex = 0; // first
        } else if (numericMatch[3]) {
          slotIndex = 1; // second
        }
      }
      
      // If no numeric match, try to match by time description
      if (slotIndex < 0 && availableSlots.length > 0) {
        const dateTimePref = parseDateTimePreference(userInput);
        
        // Try to match by time window or specific time
        for (let i = 0; i < availableSlots.length; i++) {
          const slot = availableSlots[i];
          const istSlotStart = utcToZonedTime(slot.start, 'Asia/Kolkata');
          const slotHour = istSlotStart.getHours();
          const slotMinute = istSlotStart.getMinutes();
          
          // Check if user mentioned a specific time that matches
          if (dateTimePref.specificTime) {
            const userTime = utcToZonedTime(dateTimePref.specificTime, 'Asia/Kolkata');
            const userHour = userTime.getHours();
            const userMinute = userTime.getMinutes();
            
            // Match if within 30 minutes
            if (Math.abs((slotHour * 60 + slotMinute) - (userHour * 60 + userMinute)) <= 30) {
              slotIndex = i;
              break;
            }
          }
          
          // Match by time window keywords
          if (normalizedInput.includes('morning') && slotHour >= 10 && slotHour < 12) {
            slotIndex = i;
            break;
          } else if (normalizedInput.includes('afternoon') && slotHour >= 12 && slotHour < 16) {
            slotIndex = i;
            break;
          } else if (normalizedInput.includes('evening') && slotHour >= 16 && slotHour < 18) {
            slotIndex = i;
            break;
          }
          
          // Match by specific hour mentions (e.g., "3 PM", "10 AM")
          const hourMatches = normalizedInput.match(/(\d{1,2})\s*(am|pm|o'?clock)/i);
          if (hourMatches) {
            let mentionedHour = parseInt(hourMatches[1], 10);
            const isPM = hourMatches[2] && hourMatches[2].toLowerCase().includes('pm');
            if (mentionedHour === 12 && !isPM) mentionedHour = 0;
            else if (mentionedHour !== 12 && isPM) mentionedHour += 12;
            
            if (Math.abs(slotHour - mentionedHour) <= 1) {
              slotIndex = i;
              break;
            }
          }
        }
      }
      
      // If still no match, try to match by "earlier" or "later"
      if (slotIndex < 0 && availableSlots.length >= 2) {
        if (normalizedInput.includes('earlier') || normalizedInput.includes('first') || normalizedInput.includes('sooner')) {
          slotIndex = 0;
        } else if (normalizedInput.includes('later') || normalizedInput.includes('second') || normalizedInput.includes('after')) {
          slotIndex = 1;
        }
      }

      if (slotIndex >= 0 && slotIndex < availableSlots.length) {
        const selectedSlot = availableSlots[slotIndex];
        session.updateSlots({ selected_slot: selectedSlot });
        session.transitionTo(DIALOG_STATES.SLOT_CONFIRMATION);

        const response = `Great. Confirming your tentative advisor slot for ${slots.topic} on ${formatSlot(selectedSlot.start, selectedSlot.end)}. Is that correct?`;
        session.addMessage('assistant', response);
        return {
          response,
          state: session.getState(),
          intent: session.getIntent(),
          slots: session.getSlots(),
          toolCalls: []
        };
      } else {
        // Provide helpful error with slot details
        const slotDescriptions = availableSlots.map((slot, idx) => {
          const istStart = utcToZonedTime(slot.start, 'Asia/Kolkata');
          return `Option ${idx + 1}: ${format(istStart, 'h:mm a')} IST`;
        }).join('\n');
        
        const response = `I have these options:\n${slotDescriptions}\n\nYou can say "1" or "2", "first" or "second", or describe the time like "3 PM" or "morning". Which would you prefer?`;
        session.addMessage('assistant', response);
        return {
          response,
          state: session.getState(),
          intent: session.getIntent(),
          slots: session.getSlots(),
          toolCalls: []
        };
      }
    }

    // Final confirmation and booking
    if (state === DIALOG_STATES.SLOT_CONFIRMATION) {
      const lowerInput = userInput.toLowerCase();
      if (lowerInput.includes('yes') || lowerInput.includes('correct') || lowerInput.includes('confirm')) {
        const selectedSlot = slots.selected_slot;
        const topic = slots.topic;
        
        // Validate required data before generating booking code
        if (!selectedSlot || !selectedSlot.start || !selectedSlot.end) {
          logger.log('error', `Missing selected slot data`, { sessionId: session.sessionId, slots });
          const response = `I'm sorry, there was an issue with the slot selection. Please try selecting a slot again.`;
          session.transitionTo(DIALOG_STATES.SLOT_OFFER);
          session.addMessage('assistant', response);
          return {
            response,
            state: session.getState(),
            intent: session.getIntent(),
            slots: session.getSlots(),
            toolCalls: []
          };
        }
        
        if (!topic) {
          logger.log('error', `Missing topic data`, { sessionId: session.sessionId, slots });
          const response = `I'm sorry, I need to know the topic. How can the advisor help you? You can choose from: KYC/Onboarding, SIP/Mandates, Statements and Tax Documents, Withdrawals and Timelines, or Account Changes and Nominee.`;
          session.transitionTo(DIALOG_STATES.TOPIC_SELECTION);
          session.addMessage('assistant', response);
          return {
            response,
            state: session.getState(),
            intent: session.getIntent(),
            slots: session.getSlots(),
            toolCalls: []
          };
        }
        
        // Generate booking code
        let bookingCode;
        try {
          bookingCode = generateBookingCode(existingCodes);
        existingCodes.add(bookingCode);
        session.updateSlots({ booking_code_generated: bookingCode });
        } catch (error) {
          logger.log('error', `Failed to generate booking code: ${error.message}`, { sessionId: session.sessionId, error: error.message });
          const response = `I'm sorry, there was an issue generating your booking code. Please try again.`;
          session.addMessage('assistant', response);
          return {
            response,
            state: session.getState(),
            intent: session.getIntent(),
            slots: session.getSlots(),
            toolCalls: []
          };
        }

        // Store booking (mock) - will be updated with event ID after creation
        mockBookings.set(bookingCode, {
          topic: topic,
          start: selectedSlot.start,
          end: selectedSlot.end,
          bookingCode,
          createdAt: new Date(),
          eventId: null // Will be set after event creation
        });

        // Execute tool calls
        const toolCallConfigs = [
          {
            name: 'event_create_tentative',
            params: {
              summary: `Advisor Q&A — ${topic} — ${bookingCode}`,
              description: `Tentative hold created via voice agent for ${topic}.`,
              startDateTime: selectedSlot.start.toISOString(),
              endDateTime: selectedSlot.end.toISOString(),
              bookingCode,
              isWaitlist: false
            }
          },
          {
            name: 'notes_append_prebooking',
            params: {
              createdAt: new Date().toISOString(),
              topic: topic,
              slotStart: selectedSlot.start.toISOString(),
              slotEnd: selectedSlot.end.toISOString(),
              bookingCode,
              isWaitlist: false,
              action: 'created'
            }
          },
          {
            name: 'email_create_advisor_draft',
            params: {
              topic: topic,
              slotStart: selectedSlot.start.toISOString(),
              slotEnd: selectedSlot.end.toISOString(),
              bookingCode,
              isWaitlist: false,
              action: 'created'
            }
          }
        ];

        const { toolCalls, results } = await this.executeToolCalls(toolCallConfigs);

        // Extract event ID from event creation result and store in map
        const eventCreateResult = results[0]; // First tool call is event_create_tentative
        let eventId = null;
        if (eventCreateResult && eventCreateResult.success && eventCreateResult.data) {
          // Extract event ID from the result
          // The MCP client's parseResult returns the event object directly, so it's in data.id
          eventId = eventCreateResult.data.id || null;
          if (eventId) {
            // Store in booking code to event ID map
            bookingCodeToEventId.set(bookingCode, eventId);
            // Update mockBookings with event ID
            const booking = mockBookings.get(bookingCode);
            if (booking) {
              booking.eventId = eventId;
              mockBookings.set(bookingCode, booking);
            }
            logger.log('system', `Stored event ID for booking code: ${bookingCode}`, { bookingCode, eventId });
          }
        }

        logger.log('tool_call', `Tool calls executed: ${toolCalls.map(t => t.function.name).join(', ')}`, { 
          sessionId: session.sessionId, 
          toolCalls: toolCalls.map(t => t.function.name),
          bookingCode,
          eventId,
          results: results.map(r => ({ success: r.success, mock: r.mock }))
        });

        const slotFormatted = formatSlot(selectedSlot.start, selectedSlot.end);
        const response = `${SYSTEM_MESSAGES.BOOKING_CODE_READ(bookingCode)} Your tentative advisor slot for ${topic} is on ${slotFormatted}. ${SYSTEM_MESSAGES.SECURE_URL(this.secureUrl)} ${SYSTEM_MESSAGES.TENTATIVE_HOLD}\n\nIs there anything else I can help you with? You can reschedule, cancel, check what to prepare, or ask about availability.`;
        
        // Store booking code and event ID in slots for future cancel/reschedule operations
        session.updateSlots({ booking_code: bookingCode, booking_code_generated: bookingCode, event_id: eventId });
        session.transitionTo(DIALOG_STATES.COMPLETED);
        session.addMessage('assistant', response);
        return {
          response,
          state: session.getState(),
          intent: session.getIntent(),
          slots: session.getSlots(),
          toolCalls
        };
      } else {
        // User wants to change - go back to time preference
        session.transitionTo(DIALOG_STATES.TIME_PREFERENCE);
        const response = `Which day and time works best? You can say things like 'tomorrow afternoon' or 'Monday after 4 PM'.`;
        session.addMessage('assistant', response);
        return {
          response,
          state: session.getState(),
          intent: session.getIntent(),
          slots: session.getSlots(),
          toolCalls: []
        };
      }
    }

    return {
      response: "I'm processing your booking request. Please wait.",
      state: session.getState(),
      intent: session.getIntent(),
      slots: session.getSlots(),
      toolCalls: []
    };
  }

  /**
   * Handle reschedule intent
   */
  async handleReschedule(session, userInput) {
    const state = session.getState();
    const slots = session.getSlots();

    // Directly trigger reschedule flow as per req.txt
    // When coming from INTENT_CONFIRMATION, immediately ask for booking code
    if (state === DIALOG_STATES.INTENT_CONFIRMATION) {
      // As per req.txt: "To reschedule, I'll use your booking code. Please share your booking code only. Do not share phone, email, or account numbers."
      const response = `To reschedule, I'll use your booking code. Please share your booking code only. Do not share phone, email, or account numbers.`;
      session.transitionTo(DIALOG_STATES.RESCHEDULE_CODE_INPUT);
      session.addMessage('assistant', response);
      return {
        response,
        state: session.getState(),
        intent: session.getIntent(),
        slots: session.getSlots(),
        toolCalls: []
      };
    }

    // Request booking code if not provided
    if (state === DIALOG_STATES.GREETING || !slots.booking_code) {
      const extractedSlots = await extractSlots(userInput, INTENTS.RESCHEDULE);
      let bookingCode = extractedSlots.booking_code;
      
      // Try to extract booking code from input if not found by AI
      if (!bookingCode) {
        // Look for pattern XX-XXX or XX-XXXX
        const codeMatch = userInput.match(/\b[A-Z]{2}-[A-Z0-9]{3,4}\b/i);
        if (codeMatch) {
          bookingCode = codeMatch[0].toUpperCase();
        }
      }

      if (bookingCode && mockBookings.has(bookingCode)) {
        session.updateSlots({ booking_code: bookingCode });
        session.transitionTo(DIALOG_STATES.RESCHEDULE_TIME);
        const booking = mockBookings.get(bookingCode);
        const response = `I found your booking for ${booking.topic} on ${formatSlot(booking.start, booking.end)}. Which day and time would work better?`;
        session.addMessage('assistant', response);
        return {
          response,
          state: session.getState(),
          intent: session.getIntent(),
          slots: session.getSlots(),
          toolCalls: []
        };
      } else if (bookingCode) {
        // Booking code provided but not found - handle gracefully and reset to normal flow
        const response = SYSTEM_MESSAGES.BOOKING_CODE_NOT_FOUND;
        session.setIntent(null);
        session.transitionTo(DIALOG_STATES.GREETING);
        session.addMessage('assistant', response);
        return {
          response,
          state: session.getState(),
          intent: session.getIntent(),
          slots: session.getSlots(),
          toolCalls: []
        };
      } else {
        // As per req.txt: "To reschedule, I'll use your booking code. Please share your booking code only. Do not share phone, email, or account numbers."
        const response = `To reschedule, I'll use your booking code. Please share your booking code only. Do not share phone, email, or account numbers.`;
        session.transitionTo(DIALOG_STATES.RESCHEDULE_CODE_INPUT);
        session.addMessage('assistant', response);
        return {
          response,
          state: session.getState(),
          intent: session.getIntent(),
          slots: session.getSlots(),
          toolCalls: []
        };
      }
    }

    // Handle booking code input
    if (state === DIALOG_STATES.RESCHEDULE_CODE_INPUT) {
      const lowerInput = userInput.toLowerCase();
      
      // Check if user forgot or doesn't have the booking code
      if (lowerInput.includes('forgot') || lowerInput.includes("don't have") || lowerInput.includes('do not have') || 
          lowerInput.includes('lost') || lowerInput.includes('cannot find') || lowerInput.includes("can't find") ||
          lowerInput.includes('dont remember') || lowerInput.includes("don't remember") || lowerInput.includes('not have')) {
        const response = SYSTEM_MESSAGES.BOOKING_CODE_FORGOTTEN;
        // Reset to intent detection after graceful decline
        session.setIntent(null);
        session.transitionTo(DIALOG_STATES.GREETING);
        session.addMessage('assistant', response);
        return {
          response,
          state: session.getState(),
          intent: session.getIntent(),
          slots: session.getSlots(),
          toolCalls: []
        };
      }
      
      const codeMatch = userInput.match(/\b[A-Z]{2}-[A-Z0-9]{3,4}\b/i);
      const bookingCode = codeMatch ? codeMatch[0].toUpperCase() : userInput.trim().toUpperCase();

      if (mockBookings.has(bookingCode)) {
        session.updateSlots({ booking_code: bookingCode });
        session.transitionTo(DIALOG_STATES.RESCHEDULE_TIME);
        const booking = mockBookings.get(bookingCode);
        const response = `I found your booking for ${booking.topic} on ${formatSlot(booking.start, booking.end)}. Which day and time would work better?`;
        session.addMessage('assistant', response);
        return {
          response,
          state: session.getState(),
          intent: session.getIntent(),
          slots: session.getSlots(),
          toolCalls: []
        };
      } else {
        // Booking code not found - provide graceful error message and reset to intent detection
        const response = SYSTEM_MESSAGES.BOOKING_CODE_NOT_FOUND;
        session.setIntent(null);
        session.transitionTo(DIALOG_STATES.GREETING);
        session.addMessage('assistant', response);
        return {
          response,
          state: session.getState(),
          intent: session.getIntent(),
          slots: session.getSlots(),
          toolCalls: []
        };
      }
    }

    // Handle new time preference
    if (state === DIALOG_STATES.RESCHEDULE_TIME) {
      const extractedSlots = await extractSlots(userInput, INTENTS.RESCHEDULE);
      let dateTimePref = parseDateTimePreference(
        userInput || 
        (extractedSlots.new_preferred_day + ' ' + extractedSlots.new_preferred_time_window) ||
        'tomorrow'
      );
      
      // Check if weekend was requested - decline gracefully
      if (dateTimePref.requestedWeekend || dateTimePref.isWeekend) {
        const response = `I understand you'd like to reschedule to a weekend, but our advisor slots are only available Monday through Friday (10 AM to 6 PM IST). Could you please provide a weekday preference? For example, you could say "Monday afternoon" or "Tuesday morning".`;
        session.addMessage('assistant', response);
        return {
          response,
          state: session.getState(),
          intent: session.getIntent(),
          slots: session.getSlots(),
          toolCalls: []
        };
      }
      
      // If standard parser didn't find date/time, try LLM interpretation
      if (!dateTimePref.date || !dateTimePref.timeWindow) {
        logger.log('llm', 'Standard parser unclear for reschedule, trying LLM interpretation', { userInput });
        const llmInterpretation = await interpretDateTimeWithLLM(userInput);
        
        if (llmInterpretation.date && llmInterpretation.timeWindow && llmInterpretation.confidence > 0.5) {
          // Check if LLM detected weekend
          if (llmInterpretation.requestedWeekend || llmInterpretation.isWeekend) {
            const response = `I understand you'd like to reschedule to a weekend, but our advisor slots are only available Monday through Friday (10 AM to 6 PM IST). Could you please provide a weekday preference? For example, you could say "Monday afternoon" or "Tuesday morning".`;
            session.addMessage('assistant', response);
            return {
              response,
              state: session.getState(),
              intent: session.getIntent(),
              slots: session.getSlots(),
              toolCalls: []
            };
          }
          
          // Use LLM interpretation - convert date string to Date object
          let parsedDate = null;
          if (llmInterpretation.date) {
            const today = new Date();
            const istToday = utcToZonedTime(today, 'Asia/Kolkata');
            
            if (llmInterpretation.date.toLowerCase() === 'today') {
              parsedDate = today;
            } else if (llmInterpretation.date.toLowerCase() === 'tomorrow') {
              parsedDate = addDays(today, 1);
            } else if (llmInterpretation.date.toLowerCase().startsWith('next ')) {
              const dayMatch = llmInterpretation.date.match(/next\s+(monday|tuesday|wednesday|thursday|friday)/i);
              if (dayMatch) {
                const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
                const targetDay = dayNames.indexOf(dayMatch[1].toLowerCase());
                if (targetDay > 0 && targetDay < 6) {
                  const currentDay = getDay(istToday);
                  const daysUntil = (targetDay - currentDay + 7) % 7 || 7;
                  parsedDate = addDays(today, daysUntil);
                }
              }
            } else {
              const fallbackParse = parseDateTimePreference(llmInterpretation.date);
              if (fallbackParse.date) {
                parsedDate = fallbackParse.date;
              } else {
                parsedDate = new Date(llmInterpretation.date);
                if (isNaN(parsedDate.getTime())) {
                  parsedDate = null;
                }
              }
            }
          }
          
          if (parsedDate) {
            const parsedIST = utcToZonedTime(parsedDate, 'Asia/Kolkata');
            const dayOfWeek = getDay(parsedIST);
            const isWeekendDate = dayOfWeek === 0 || dayOfWeek === 6;
            
            if (isWeekendDate) {
              const response = `I understand you'd like to reschedule to a weekend, but our advisor slots are only available Monday through Friday (10 AM to 6 PM IST). Could you please provide a weekday preference? For example, you could say "Monday afternoon" or "Tuesday morning".`;
              session.addMessage('assistant', response);
              return {
                response,
                state: session.getState(),
                intent: session.getIntent(),
                slots: session.getSlots(),
                toolCalls: []
              };
            }
            
            dateTimePref = {
              date: parsedDate,
              timeWindow: llmInterpretation.timeWindow,
              specificTime: null,
              isWeekend: false,
              requestedWeekend: false
            };
          } else if (llmInterpretation.needsClarification) {
            const response = `I want to make sure I understand your preferred reschedule date and time correctly. ${llmInterpretation.interpretation || 'Could you please provide a specific weekday and time preference? For example, "Monday afternoon" or "Tuesday at 3 PM".'}`;
            session.addMessage('assistant', response);
            return {
              response,
              state: session.getState(),
              intent: session.getIntent(),
              slots: session.getSlots(),
              toolCalls: []
            };
          }
        } else if (llmInterpretation.needsClarification) {
          const response = `I want to make sure I understand your preferred reschedule date and time correctly. Could you please provide a specific weekday and time preference? For example, "Monday afternoon" or "Tuesday at 3 PM".`;
          session.addMessage('assistant', response);
          return {
            response,
            state: session.getState(),
            intent: session.getIntent(),
            slots: session.getSlots(),
            toolCalls: []
          };
        }
      }
      
      if (dateTimePref.date && dateTimePref.timeWindow) {
        const availableSlots = await getAvailableSlots(
          dateTimePref.date,
          dateTimePref.timeWindow,
          30,
          Array.from(mockBookings.values()).filter(b => b.bookingCode !== slots.booking_code)
        );

        if (availableSlots.length > 0) {
          // Offer slots
          session.updateSlots({ 
            available_slots: availableSlots,
            preferred_day: dateTimePref.date,
            preferred_time_window: dateTimePref.timeWindow
          });
          
          const slotTexts = availableSlots.map((slot, index) => 
            `${index + 1}. ${formatSlot(slot.start, slot.end)}`
          ).join('\n');

          const response = `I have these available slots:\n${slotTexts}\nWhich do you prefer, 1 or 2?`;
          session.transitionTo(DIALOG_STATES.SLOT_OFFER);
          session.addMessage('assistant', response);
          return {
            response,
            state: session.getState(),
            intent: session.getIntent(),
            slots: session.getSlots(),
            toolCalls: []
          };
        } else {
          const response = `I don't have any available slots in that time window. Would you like to try a different time?`;
          session.addMessage('assistant', response);
          return {
            response,
            state: session.getState(),
            intent: session.getIntent(),
            slots: session.getSlots(),
            toolCalls: []
          };
        }
      } else {
        const response = `Which day and time would work better? You can say things like 'tomorrow afternoon' or 'Monday after 4 PM'.`;
        session.addMessage('assistant', response);
        return {
          response,
          state: session.getState(),
          intent: session.getIntent(),
          slots: session.getSlots(),
          toolCalls: []
        };
      }
    }

    // Handle slot selection for reschedule - create tentative hold first
    if (state === DIALOG_STATES.SLOT_OFFER && session.getIntent() === INTENTS.RESCHEDULE) {
      const slotIndex = parseInt(userInput.trim()) - 1;
      const availableSlots = slots.available_slots || [];

      if (slotIndex >= 0 && slotIndex < availableSlots.length) {
        const selectedSlot = availableSlots[slotIndex];
        
        // Store selected slot for confirmation
        session.updateSlots({ selected_slot: selectedSlot });
        session.transitionTo(DIALOG_STATES.RESCHEDULE_SLOT_CONFIRMATION);
        
        const response = `Great. Confirming reschedule to ${formatSlot(selectedSlot.start, selectedSlot.end)}. Is that correct?`;
        session.addMessage('assistant', response);
        return {
          response,
          state: session.getState(),
          intent: session.getIntent(),
          slots: session.getSlots(),
          toolCalls: []
        };
      } else {
        const response = `Please choose option 1 or 2.`;
        session.addMessage('assistant', response);
        return {
          response,
          state: session.getState(),
          intent: session.getIntent(),
          slots: session.getSlots(),
          toolCalls: []
        };
      }
    }

    // Handle reschedule slot confirmation - finalize after user confirms
    if (state === DIALOG_STATES.RESCHEDULE_SLOT_CONFIRMATION) {
      const lowerInput = userInput.toLowerCase();
      const selectedSlot = slots.selected_slot;
      
      if (lowerInput.includes('yes') || lowerInput.includes('confirm') || lowerInput.includes('correct')) {
        if (!selectedSlot) {
          const response = `I'm sorry, there was an issue with the slot selection. Please try again.`;
          session.addMessage('assistant', response);
          return {
            response,
            state: session.getState(),
            intent: session.getIntent(),
            slots: session.getSlots(),
            toolCalls: []
          };
        }

          const booking = mockBookings.get(slots.booking_code);
        if (!booking) {
          const response = `I'm sorry, I couldn't find your booking. Please try again.`;
          session.addMessage('assistant', response);
          return {
            response,
            state: session.getState(),
            intent: session.getIntent(),
            slots: session.getSlots(),
            toolCalls: []
          };
        }
          
        // Create tentative hold (update booking with new time)
          booking.start = selectedSlot.start;
          booking.end = selectedSlot.end;

        // Get event ID from map, fallback to booking or session
        const eventId = bookingCodeToEventId.get(slots.booking_code) || booking.eventId || slots.event_id || null;
        
        // Update booking with event ID if found in map
        if (eventId && !booking.eventId) {
          booking.eventId = eventId;
          mockBookings.set(slots.booking_code, booking);
        }
        
        // Execute tool calls for reschedule - include eventId if available
        const toolCallConfigs = [
          {
            name: 'event_update_time',
            params: {
              bookingCode: slots.booking_code,
              eventId: eventId, // Use eventId from map, booking, or session
              newStartDateTime: selectedSlot.start.toISOString(),
              newEndDateTime: selectedSlot.end.toISOString()
            }
          },
          {
            name: 'notes_append_prebooking',
            params: {
              createdAt: new Date().toISOString(),
              topic: booking.topic,
              slotStart: selectedSlot.start.toISOString(),
              slotEnd: selectedSlot.end.toISOString(),
              bookingCode: slots.booking_code,
              isWaitlist: false,
              action: 'rescheduled'
            }
          },
          {
            name: 'email_create_advisor_draft',
            params: {
              topic: booking.topic,
              slotStart: selectedSlot.start.toISOString(),
              slotEnd: selectedSlot.end.toISOString(),
              bookingCode: slots.booking_code,
              isWaitlist: false,
              action: 'rescheduled'
            }
          }
        ];

        const { toolCalls, results } = await this.executeToolCalls(toolCallConfigs);

        logger.log('tool_call', `Tool calls executed: ${toolCalls.map(t => t.function.name).join(', ')}`, { 
          sessionId: session.sessionId, 
          toolCalls: toolCalls.map(t => t.function.name),
          bookingCode: slots.booking_code 
        });

        const response = `Your appointment has been rescheduled to ${formatSlot(selectedSlot.start, selectedSlot.end)}. Your booking code remains ${slots.booking_code}. ${SYSTEM_MESSAGES.SECURE_URL(this.secureUrl)} Please update your contact details using the same secure link if needed.\n\nIs there anything else I can help you with?`;
        
        // Preserve booking code for future operations
        session.updateSlots({ booking_code: slots.booking_code, booking_code_generated: slots.booking_code });
          session.transitionTo(DIALOG_STATES.COMPLETED);
          session.addMessage('assistant', response);
          return {
            response,
            state: session.getState(),
            intent: session.getIntent(),
            slots: session.getSlots(),
            toolCalls
          };
      } else if (lowerInput.includes('no') || lowerInput.includes('not') || lowerInput.includes('wrong')) {
        // User rejected the slot - go back to time preference
        session.updateSlots({ selected_slot: null });
        session.transitionTo(DIALOG_STATES.RESCHEDULE_TIME);
        const response = `No problem. Which day and time would work better?`;
        session.addMessage('assistant', response);
        return {
          response,
          state: session.getState(),
          intent: session.getIntent(),
          slots: session.getSlots(),
          toolCalls: []
        };
      } else {
        // Unclear response - ask for clarification
        const response = `Please confirm: Is ${formatSlot(selectedSlot.start, selectedSlot.end)} correct? (yes/no)`;
        session.addMessage('assistant', response);
        return {
          response,
          state: session.getState(),
          intent: session.getIntent(),
          slots: session.getSlots(),
          toolCalls: []
        };
      }
    }

    return {
      response: "I'm processing your reschedule request.",
      state: session.getState(),
      intent: session.getIntent(),
      slots: session.getSlots(),
      toolCalls: []
    };
  }

  /**
   * Handle cancel intent
   */
  async handleCancel(session, userInput) {
    const state = session.getState();
    const slots = session.getSlots();

    // Directly trigger cancel flow as per req.txt
    // When coming from INTENT_CONFIRMATION, immediately ask for booking code
    if (state === DIALOG_STATES.INTENT_CONFIRMATION) {
      // As per req.txt: Ask for booking code only
      const response = `To cancel, I'll need your booking code. Please share your booking code only. Do not share phone, email, or account numbers.`;
      session.transitionTo(DIALOG_STATES.CANCEL_CODE_INPUT);
      session.addMessage('assistant', response);
      return {
        response,
        state: session.getState(),
        intent: session.getIntent(),
        slots: session.getSlots(),
        toolCalls: []
      };
    }

    // Step 1: Ask for booking code if not provided
    if (state === DIALOG_STATES.GREETING || !slots.booking_code) {
      const lowerInput = userInput.toLowerCase();
      
      // Check if user forgot or doesn't have the booking code
      if (lowerInput.includes('forgot') || lowerInput.includes("don't have") || lowerInput.includes('do not have') || 
          lowerInput.includes('lost') || lowerInput.includes('cannot find') || lowerInput.includes("can't find") ||
          lowerInput.includes('dont remember') || lowerInput.includes("don't remember") || lowerInput.includes('not have')) {
        const response = SYSTEM_MESSAGES.BOOKING_CODE_FORGOTTEN;
        // Reset to intent detection after graceful decline
        session.setIntent(null);
        session.transitionTo(DIALOG_STATES.GREETING);
        session.addMessage('assistant', response);
        return {
          response,
          state: session.getState(),
          intent: session.getIntent(),
          slots: session.getSlots(),
          toolCalls: []
        };
      }
      
      const extractedSlots = await extractSlots(userInput, INTENTS.CANCEL);
      let bookingCode = extractedSlots.booking_code;
      
      // Try to extract booking code from input if not found by AI
      if (!bookingCode) {
        const codeMatch = userInput.match(/\b[A-Z]{2}-[A-Z0-9]{3,4}\b/i);
        if (codeMatch) {
          bookingCode = codeMatch[0].toUpperCase();
        }
      }

      if (bookingCode && mockBookings.has(bookingCode)) {
        const booking = mockBookings.get(bookingCode);
        
        // Create tentative hold - store booking code and ask for confirmation
        session.updateSlots({ booking_code: bookingCode });
        session.transitionTo(DIALOG_STATES.CANCEL_CONFIRMATION);
        
        const response = `I found your booking for ${booking.topic} on ${formatSlot(booking.start, booking.end)}. Are you sure you want to cancel this appointment?`;
        session.addMessage('assistant', response);
        return {
          response,
          state: session.getState(),
          intent: session.getIntent(),
          slots: session.getSlots(),
          toolCalls: []
        };
      } else if (bookingCode) {
        // Booking code provided but not found - reset to intent detection
        const response = SYSTEM_MESSAGES.BOOKING_CODE_NOT_FOUND;
        session.setIntent(null);
        session.transitionTo(DIALOG_STATES.GREETING);
        session.addMessage('assistant', response);
        return {
          response,
          state: session.getState(),
          intent: session.getIntent(),
          slots: session.getSlots(),
          toolCalls: []
        };
      } else {
        // As per req.txt: Ask for booking code only
        const response = `To cancel, I'll need your booking code. Please share your booking code only. Do not share phone, email, or account numbers.`;
        session.transitionTo(DIALOG_STATES.CANCEL_CODE_INPUT);
        session.addMessage('assistant', response);
        return {
          response,
          state: session.getState(),
          intent: session.getIntent(),
          slots: session.getSlots(),
          toolCalls: []
        };
      }
    }

    // Handle booking code input
    if (state === DIALOG_STATES.CANCEL_CODE_INPUT) {
      const lowerInput = userInput.toLowerCase();
      
      // Check if user forgot or doesn't have the booking code
      if (lowerInput.includes('forgot') || lowerInput.includes("don't have") || lowerInput.includes('do not have') || 
          lowerInput.includes('lost') || lowerInput.includes('cannot find') || lowerInput.includes("can't find") ||
          lowerInput.includes('dont remember') || lowerInput.includes("don't remember") || lowerInput.includes('not have')) {
        const response = SYSTEM_MESSAGES.BOOKING_CODE_FORGOTTEN;
        session.addMessage('assistant', response);
        return {
          response,
          state: session.getState(),
          intent: session.getIntent(),
          slots: session.getSlots(),
          toolCalls: []
        };
      }
      
      const codeMatch = userInput.match(/\b[A-Z]{2}-[A-Z0-9]{3,4}\b/i);
      const bookingCode = codeMatch ? codeMatch[0].toUpperCase() : userInput.trim().toUpperCase();

      if (mockBookings.has(bookingCode)) {
        const booking = mockBookings.get(bookingCode);
        
        // Create tentative hold - store booking code and ask for confirmation
        session.updateSlots({ booking_code: bookingCode });
        session.transitionTo(DIALOG_STATES.CANCEL_CONFIRMATION);
        
        const response = `I found your booking for ${booking.topic} on ${formatSlot(booking.start, booking.end)}. Are you sure you want to cancel this appointment?`;
        session.addMessage('assistant', response);
        return {
          response,
          state: session.getState(),
          intent: session.getIntent(),
          slots: session.getSlots(),
          toolCalls: []
        };
      } else {
        // Booking code not found - provide graceful error message and reset to intent detection
        const response = SYSTEM_MESSAGES.BOOKING_CODE_NOT_FOUND;
        session.setIntent(null);
        session.transitionTo(DIALOG_STATES.GREETING);
        session.addMessage('assistant', response);
        return {
          response,
          state: session.getState(),
          intent: session.getIntent(),
          slots: session.getSlots(),
          toolCalls: []
        };
      }
    }

    // Handle cancel confirmation - finalize after user confirms
    if (state === DIALOG_STATES.CANCEL_CONFIRMATION) {
      const lowerInput = userInput.toLowerCase();
      const bookingCode = slots.booking_code;
      
      if (lowerInput.includes('yes') || lowerInput.includes('confirm') || lowerInput.includes('sure') || lowerInput.includes('cancel')) {
        if (!bookingCode || !mockBookings.has(bookingCode)) {
          const response = `I'm sorry, I couldn't find your booking. Please try again.`;
          session.addMessage('assistant', response);
          return {
            response,
            state: session.getState(),
            intent: session.getIntent(),
            slots: session.getSlots(),
            toolCalls: []
          };
        }

        const booking = mockBookings.get(bookingCode);
        
        // Get event ID from map, fallback to booking or session
        const eventId = bookingCodeToEventId.get(bookingCode) || booking.eventId || slots.event_id || null;
        
        // Execute cancellation - delete booking and create tool calls
        mockBookings.delete(bookingCode);
        existingCodes.delete(bookingCode);
        // Remove from booking code to event ID map
        if (bookingCodeToEventId.has(bookingCode)) {
          bookingCodeToEventId.delete(bookingCode);
        }

        // Execute tool calls for cancellation - include eventId if available
        const toolCallConfigs = [
          {
            name: 'event_cancel',
            params: { 
              bookingCode,
              eventId: eventId // Use eventId from map, booking, or session
            }
          },
          {
            name: 'notes_append_prebooking',
            params: {
              createdAt: new Date().toISOString(),
              topic: booking.topic,
              slotStart: booking.start.toISOString(),
              slotEnd: booking.end.toISOString(),
              bookingCode,
              isWaitlist: false,
              action: 'cancelled'
            }
          },
          {
            name: 'email_create_advisor_draft',
            params: {
              topic: booking.topic,
              slotStart: booking.start.toISOString(),
              slotEnd: booking.end.toISOString(),
              bookingCode,
              isWaitlist: false,
              action: 'cancelled'
            }
          }
        ];

        const { toolCalls, results } = await this.executeToolCalls(toolCallConfigs);

        logger.log('tool_call', `Tool calls executed: ${toolCalls.map(t => t.function.name).join(', ')}`, { 
          sessionId: session.sessionId, 
          toolCalls: toolCalls.map(t => t.function.name),
          bookingCode 
        });

        const response = `Your tentative advisor appointment with code ${bookingCode} is now cancelled.\n\nIs there anything else I can help you with? You can book a new appointment, check what to prepare, or ask about availability.`;
        
        // Clear booking code since it's cancelled
        session.updateSlots({ booking_code: null, booking_code_generated: null });
        session.transitionTo(DIALOG_STATES.COMPLETED);
        session.addMessage('assistant', response);
        return {
          response,
          state: session.getState(),
          intent: session.getIntent(),
          slots: session.getSlots(),
          toolCalls
        };
      } else if (lowerInput.includes('no') || lowerInput.includes('not') || lowerInput.includes('keep')) {
        // User changed their mind - reset to intent detection
        session.updateSlots({ booking_code: null });
        session.setIntent(null);
        session.transitionTo(DIALOG_STATES.GREETING);
        const response = `No problem. Your appointment remains scheduled. Is there anything else I can help you with?`;
        session.addMessage('assistant', response);
        return {
          response,
          state: session.getState(),
          intent: session.getIntent(),
          slots: session.getSlots(),
          toolCalls: []
        };
      } else {
        // Unclear response - ask for clarification
        const booking = mockBookings.get(bookingCode);
        const response = `Please confirm: Do you want to cancel your appointment for ${booking ? formatSlot(booking.start, booking.end) : 'this booking'}? (yes/no)`;
        session.addMessage('assistant', response);
        return {
          response,
          state: session.getState(),
          intent: session.getIntent(),
          slots: session.getSlots(),
          toolCalls: []
        };
      }
    }

    return {
      response: "I'm processing your cancellation request.",
      state: session.getState(),
      intent: session.getIntent(),
      slots: session.getSlots(),
      toolCalls: []
    };
  }

  /**
   * Handle what to prepare intent
   */
  async handleWhatToPrepare(session, userInput) {
    const state = session.getState();
    
    // Directly trigger what to prepare flow as per req.txt
    // When coming from INTENT_CONFIRMATION, immediately ask for topic
    if (state === DIALOG_STATES.INTENT_CONFIRMATION) {
      // As per req.txt: "Is this for KYC/Onboarding, SIP/Mandates, Statements and Tax Documents, Withdrawals and Timelines, or Account Changes and Nominee?"
      const response = `Is this for KYC/Onboarding, SIP/Mandates, Statements and Tax Documents, Withdrawals and Timelines, or Account Changes and Nominee?`;
      session.transitionTo(DIALOG_STATES.PREPARATION_INFO);
      session.addMessage('assistant', response);
      return {
        response,
        state: session.getState(),
        intent: session.getIntent(),
        slots: session.getSlots(),
        toolCalls: []
      };
    }
    
    // Handle topic extraction and preparation guide
    if (state === DIALOG_STATES.GREETING || state === DIALOG_STATES.PREPARATION_INFO) {
      // Extract topic from user input
    const extractedSlots = await extractSlots(userInput, INTENTS.WHAT_TO_PREPARE);
    let topic = extractedSlots.topic || mapToTopic(userInput);

      // If no topic found, ask for it as per req.txt
    if (!topic || !isValidTopic(topic)) {
      const response = `Is this for KYC/Onboarding, SIP/Mandates, Statements and Tax Documents, Withdrawals and Timelines, or Account Changes and Nominee?`;
        session.transitionTo(DIALOG_STATES.PREPARATION_INFO);
      session.addMessage('assistant', response);
      return {
        response,
        state: session.getState(),
        intent: session.getIntent(),
        slots: session.getSlots(),
        toolCalls: []
      };
    }

      // Validate and provide preparation guide
      if (topic && isValidTopic(topic)) {
    const guides = PREPARATION_GUIDES[topic] || [];
        const response = `For ${topic}, please prepare:\n${guides.map((item, i) => `${i + 1}. ${item}`).join('\n')}\n\nWould you like to book an appointment for ${topic}?`;
        
        session.updateSlots({ topic });
        
        // Preserve booking code if it exists for future operations
        const existingBookingCode = session.getSlots().booking_code || session.getSlots().booking_code_generated;
        if (existingBookingCode) {
          session.updateSlots({ booking_code: existingBookingCode, booking_code_generated: existingBookingCode });
        }
    
    session.transitionTo(DIALOG_STATES.COMPLETED);
    session.addMessage('assistant', response);
    return {
      response,
          state: session.getState(),
          intent: session.getIntent(),
          slots: session.getSlots(),
          toolCalls: []
        };
      }
    }
    
    // Handle preparation info state (when user provides topic)
    if (state === DIALOG_STATES.PREPARATION_INFO) {
      const extractedSlots = await extractSlots(userInput, INTENTS.WHAT_TO_PREPARE);
      let topic = extractedSlots.topic || mapToTopic(userInput);
      
      if (topic && isValidTopic(topic)) {
        const guides = PREPARATION_GUIDES[topic] || [];
        const response = `For ${topic}, please prepare:\n${guides.map((item, i) => `${i + 1}. ${item}`).join('\n')}\n\nWould you like to book an appointment for ${topic}?`;
        
        session.updateSlots({ topic });
        
        // Preserve booking code if it exists for future operations
        const existingBookingCode = session.getSlots().booking_code || session.getSlots().booking_code_generated;
        if (existingBookingCode) {
          session.updateSlots({ booking_code: existingBookingCode, booking_code_generated: existingBookingCode });
        }
        
        session.transitionTo(DIALOG_STATES.COMPLETED);
        session.addMessage('assistant', response);
        return {
          response,
          state: session.getState(),
          intent: session.getIntent(),
          slots: session.getSlots(),
          toolCalls: []
        };
      } else {
        const response = `I can help you prepare for your advisor meeting. Is this for KYC/Onboarding, SIP/Mandates, Statements and Tax Documents, Withdrawals and Timelines, or Account Changes and Nominee?`;
        session.addMessage('assistant', response);
        return {
          response,
          state: session.getState(),
          intent: session.getIntent(),
          slots: session.getSlots(),
          toolCalls: []
        };
      }
    }
    
    return {
      response: "I'm helping you prepare for your advisor meeting.",
      state: session.getState(),
      intent: session.getIntent(),
      slots: session.getSlots(),
      toolCalls: []
    };
  }

  /**
   * Handle check availability intent
   */
  async handleCheckAvailability(session, userInput) {
    const state = session.getState();
    
    // Directly trigger check availability flow as per req.txt
    // When coming from INTENT_CONFIRMATION, immediately ask for day range
    if (state === DIALOG_STATES.INTENT_CONFIRMATION) {
      // As per req.txt: "Are you looking for slots today, tomorrow, or this week?"
      const response = `Are you looking for slots today, tomorrow, or this week?`;
      session.transitionTo(DIALOG_STATES.AVAILABILITY_CHECK);
      session.addMessage('assistant', response);
      return {
        response,
        state: session.getState(),
        intent: session.getIntent(),
        slots: session.getSlots(),
        toolCalls: []
      };
    }
    
    // Handle day range extraction and availability check
    if (state === DIALOG_STATES.GREETING || state === DIALOG_STATES.AVAILABILITY_CHECK) {
      // Extract day range from user input
    const extractedSlots = await extractSlots(userInput, INTENTS.CHECK_AVAILABILITY);
      let dayRange = extractedSlots.day_range;
      
      // If no day range, ask for it as per req.txt
      if (!dayRange) {
        const response = `Are you looking for slots today, tomorrow, or this week?`;
        session.transitionTo(DIALOG_STATES.AVAILABILITY_CHECK);
        session.addMessage('assistant', response);
        return {
          response,
          state: session.getState(),
          intent: session.getIntent(),
          slots: session.getSlots(),
          toolCalls: []
        };
      }
      
      // Process day range
      dayRange = dayRange || userInput || 'today';
      const dateTimePref = parseDateTimePreference(dayRange);

      // Get available slots
    const availableSlots = getAvailableSlots(
      dateTimePref.date || new Date(),
      dateTimePref.timeWindow || 'any',
      30,
      Array.from(mockBookings.values())
    );

    if (availableSlots.length > 0) {
        // Format slots as per req.txt: "Today I have: 11:00–11:30 AM IST, 3:00–3:30 PM IST."
        const istStart = utcToZonedTime(availableSlots[0].start, 'Asia/Kolkata');
        const today = utcToZonedTime(new Date(), 'Asia/Kolkata');
        const tomorrow = addDays(today, 1);
        
        let dateLabel = 'Today';
        if (format(istStart, 'yyyy-MM-dd') === format(tomorrow, 'yyyy-MM-dd')) {
          dateLabel = 'Tomorrow';
        } else if (format(istStart, 'yyyy-MM-dd') !== format(today, 'yyyy-MM-dd')) {
          dateLabel = format(istStart, 'EEEE');
        }
        
        const slotTimes = availableSlots.map(slot => {
          const istSlotStart = utcToZonedTime(slot.start, 'Asia/Kolkata');
          const istSlotEnd = utcToZonedTime(slot.end, 'Asia/Kolkata');
          return `${format(istSlotStart, 'h:mm a')}–${format(istSlotEnd, 'h:mm a')} IST`;
        }).join(', ');
        
        // As per req.txt: Read them out and optionally offer to directly book
        const response = `${dateLabel} I have: ${slotTimes}.\n\nWould you like to book one of these? You can say "book slot 1" or "book the first one".`;
        
        // Store available slots for potential booking
        session.updateSlots({ available_slots: availableSlots });
        session.addMessage('assistant', response);
        return {
          response,
          state: session.getState(),
          intent: session.getIntent(),
          slots: session.getSlots(),
          toolCalls: []
        };
      } else {
        const response = `I don't have any available slots in that time window. Would you like to check a different time? You can say "tomorrow", "this week", or a specific day.`;
        session.transitionTo(DIALOG_STATES.AVAILABILITY_CHECK);
        session.addMessage('assistant', response);
        return {
          response,
          state: session.getState(),
          intent: session.getIntent(),
          slots: session.getSlots(),
          toolCalls: []
        };
      }
    }
    
    // Handle availability check state (when user provides day range)
    if (state === DIALOG_STATES.AVAILABILITY_CHECK) {
      const extractedSlots = await extractSlots(userInput, INTENTS.CHECK_AVAILABILITY);
      const dayRange = extractedSlots.day_range || userInput || 'today';
      const dateTimePref = parseDateTimePreference(dayRange);

      const availableSlots = getAvailableSlots(
        dateTimePref.date || new Date(),
        dateTimePref.timeWindow || 'any',
        30,
        Array.from(mockBookings.values())
      );

      if (availableSlots.length > 0) {
        const slotTexts = availableSlots.map((slot, index) => 
          `${index + 1}. ${formatSlot(slot.start, slot.end)}`
        ).join('\n');
        
      const response = `I have these available slots:\n${slotTexts}\n\nWould you like to book one of these?`;
        session.updateSlots({ available_slots: availableSlots });
      session.addMessage('assistant', response);
      return {
        response,
        state: session.getState(),
        intent: session.getIntent(),
        slots: session.getSlots(),
        toolCalls: []
      };
    } else {
      const response = `I don't have any available slots in that time window. Would you like to check a different time?`;
      session.addMessage('assistant', response);
      return {
        response,
        state: session.getState(),
        intent: session.getIntent(),
        slots: session.getSlots(),
        toolCalls: []
      };
    }
    }
    
    return {
      response: "I'm checking availability for you.",
      state: session.getState(),
      intent: session.getIntent(),
      slots: session.getSlots(),
      toolCalls: []
    };
  }
}

