/**
 * AI Service - Integration with Groq/Claude/Gemini
 */

import Groq from 'groq-sdk';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import { 
  intentClassificationLimiter, 
  slotExtractionLimiter, 
  generalAPILimiter 
} from '../utils/rateLimiter.js';
import { 
  classifyIntentWithKeywords, 
  isRateLimitError, 
  shouldUseKeywordFallback 
} from '../utils/keywordClassifier.js';
import { logger } from '../utils/logger.js';

dotenv.config();

const AI_PROVIDER = process.env.AI_PROVIDER || 'groq';

// Detect if we're in a test environment
const IS_TEST_ENV = process.env.NODE_ENV === 'test' || 
                     process.env.JEST_WORKER_ID !== undefined ||
                     typeof jest !== 'undefined' ||
                     (typeof process !== 'undefined' && process.argv.some(arg => arg.includes('jest')));

let groqClient = null;
let claudeClient = null;

// Initialize clients based on provider (skip in test environment)
if (!IS_TEST_ENV) {
  if (AI_PROVIDER === 'groq') {
    if (process.env.GROQ_API_KEY) {
      groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
      console.log('✅ Groq client initialized');
    } else {
      console.warn('⚠️  GROQ_API_KEY not found in environment variables');
    }
  }

  if (AI_PROVIDER === 'claude') {
    if (process.env.ANTHROPIC_API_KEY) {
      claudeClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      console.log('✅ Claude client initialized');
    } else {
      console.warn('⚠️  ANTHROPIC_API_KEY not found in environment variables');
    }
  }
} else {
  console.log('⚠️  Test environment detected: Skipping AI client initialization. Using keyword-based fallback for all AI operations.');
}

/**
 * Get AI response with function calling support and rate limiting
 * @param {string} systemPrompt - System prompt
 * @param {Array} messages - Conversation messages
 * @param {Array} tools - Available tools/functions
 * @returns {Promise<Object>} AI response with content and tool calls
 */
export async function getAIResponse(systemPrompt, messages, tools = []) {
  // Skip API calls in test environment
  if (IS_TEST_ENV) {
    console.log('⚠️  Test environment: Skipping Groq API call. This should be mocked in tests.');
    throw new Error('API calls are disabled in test environment. Use mocks instead.');
  }

  try {
    if (AI_PROVIDER === 'groq') {
      if (!groqClient) {
        throw new Error('Groq client not initialized. Please set GROQ_API_KEY in your .env file');
      }
      return await getGroqResponse(systemPrompt, messages, tools);
    } else if (AI_PROVIDER === 'claude') {
      if (!claudeClient) {
        throw new Error('Claude client not initialized. Please set ANTHROPIC_API_KEY in your .env file');
      }
      // Apply rate limiting for Claude as well
      await generalAPILimiter.waitIfNeeded();
      return await getClaudeResponse(systemPrompt, messages, tools);
    } else {
      throw new Error(`AI provider "${AI_PROVIDER}" not supported. Use "groq" or "claude"`);
    }
  } catch (error) {
    // Enhance error with rate limit detection
    if (isRateLimitError(error)) {
      error.isRateLimit = true;
    }
    
    console.error('AI Service Error:', error.message);
    if (error.status || error.response?.status) {
      console.error('API Response Status:', error.status || error.response.status);
    }
    if (error.response?.data) {
      console.error('API Response Data:', error.response.data);
    }
    throw error;
  }
}

/**
 * Get response from Groq with rate limiting and error handling
 */
async function getGroqResponse(systemPrompt, messages, tools, retryCount = 0) {
  const MAX_RETRIES = 2;
  const RETRY_DELAY_BASE = 1000; // Base delay in ms
  
  try {
    // Determine which rate limiter to use
    const isIntentClassification = systemPrompt.includes('intent classifier') || 
                                   systemPrompt.includes('expert intent classifier');
    const isSlotExtraction = systemPrompt.includes('slot extractor');
    
    const limiter = isIntentClassification 
      ? intentClassificationLimiter 
      : isSlotExtraction 
        ? slotExtractionLimiter 
        : generalAPILimiter;
    
    // Wait if rate limit would be exceeded
    await limiter.waitIfNeeded();
    
    // Use a current Groq model - llama-3.3-70b-versatile or fallback to llama-3.1-8b-instant
    const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
    
    // Optimize parameters for intent classification vs other tasks
    const temperature = isIntentClassification ? 0.1 : 0.3; // Very low temperature for consistent classification
    const maxTokens = isIntentClassification ? 50 : 500; // Very short response for intent classification
    
    const completion = await groqClient.chat.completions.create({
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages
      ],
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: tools.length > 0 ? 'auto' : undefined,
      temperature: temperature,
      max_tokens: maxTokens,
      stream: false
    });

    if (!completion || !completion.choices || completion.choices.length === 0) {
      throw new Error('No response from Groq API');
    }

    const response = completion.choices[0];
    
    if (!response || !response.message) {
      throw new Error('Invalid response structure from Groq API');
    }
    
    return {
      content: response.message.content || '',
      toolCalls: response.message.tool_calls || [],
      finishReason: response.finish_reason
    };
  } catch (error) {
    // Handle rate limit errors with exponential backoff retry
    if (isRateLimitError(error) && retryCount < MAX_RETRIES) {
      const retryDelay = RETRY_DELAY_BASE * Math.pow(2, retryCount); // Exponential backoff
      console.warn(`⚠️  Rate limit hit. Retrying in ${retryDelay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})...`);
      
      await new Promise(resolve => setTimeout(resolve, retryDelay));
      return await getGroqResponse(systemPrompt, messages, tools, retryCount + 1);
    }
    
    // Log error details
    console.error('Groq API Error:', error.message);
    if (error.status) {
      console.error('Status Code:', error.status);
    }
    if (error.response) {
      console.error('API Response:', error.response.data);
    }
    
    // Enhance error with rate limit info
    if (isRateLimitError(error)) {
      error.isRateLimit = true;
      error.retryAfter = error.response?.headers?.['retry-after'] || 60;
    }
    
    throw error;
  }
}

/**
 * Get response from Claude
 */
async function getClaudeResponse(systemPrompt, messages, tools) {
  // Convert messages format for Claude
  const claudeMessages = messages.map(msg => ({
    role: msg.role === 'assistant' ? 'assistant' : 'user',
    content: msg.content
  }));

  const completion = await claudeClient.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 1000,
    system: systemPrompt,
    messages: claudeMessages,
    tools: tools.length > 0 ? tools : undefined
  });

  const content = completion.content.find(c => c.type === 'text');
  const toolCalls = completion.content.filter(c => c.type === 'tool_use');

  return {
    content: content?.text || '',
    toolCalls: toolCalls.map(tc => ({
      id: tc.id,
      type: 'function',
      function: {
        name: tc.name,
        arguments: JSON.stringify(tc.input)
      }
    })),
    finishReason: completion.stop_reason
  };
}

/**
 * Classify intent from user input using LLM with keyword fallback
 * @param {string} userInput - User's input text
 * @param {number} retryCount - Number of retry attempts (internal)
 * @returns {Promise<string>} Intent classification
 */
export async function classifyIntent(userInput, retryCount = 0) {
  // Skip API calls in test environment - use keyword classifier instead
  if (IS_TEST_ENV) {
    console.log(`⚠️  Test environment: Skipping Groq API call for intent classification. Using keyword-based classifier instead.`);
    const keywordIntent = classifyIntentWithKeywords(userInput);
    logger.log('keyword', `Intent classified via keywords (test mode): ${keywordIntent}`, { 
      userInput, 
      intent: keywordIntent,
      method: 'keyword_test_mode' 
    });
    return keywordIntent;
  }

  const MAX_RETRIES = 2;
  const validIntents = ['book_new', 'reschedule', 'cancel', 'what_to_prepare', 'check_availability'];
  
  const systemPrompt = `You are an expert intent classifier for an advisor appointment scheduling system.

Your task is to analyze the user's input and classify it into EXACTLY ONE of these 5 categories:

CATEGORY 1: book_new
- User wants to book a new appointment
- Examples: "I want to book an appointment", "Schedule a call", "I need to talk to an advisor", "Book me a slot", "I'd like to set up a meeting"

CATEGORY 2: reschedule
- User wants to reschedule an existing appointment
- Examples: "I need to reschedule", "Change my appointment time", "Move my booking", "Can I reschedule my slot", "I want to change the time"

CATEGORY 3: cancel
- User wants to cancel an appointment
- Examples: "Cancel my appointment", "I can't make it", "Please cancel", "Remove my booking", "I need to cancel"

CATEGORY 4: what_to_prepare
- User wants to know what to prepare for a meeting
- Examples: "What should I bring", "What documents do I need", "What to prepare", "What do I need for the meeting", "Preparation checklist"

CATEGORY 5: check_availability
- User wants to check available time slots
- Examples: "When are you available", "What slots are open", "Show me available times", "When can I book", "What times work"

CRITICAL RULES:
1. Respond with ONLY the intent name from the list above (book_new, reschedule, cancel, what_to_prepare, or check_availability)
2. Do NOT include any explanations, descriptions, or additional text
3. Do NOT use variations or synonyms - use the exact intent name
4. If the input is ambiguous, choose the most likely intent based on context
5. If the user is asking about booking a new appointment, use "book_new"
6. If the user is asking about changing an existing appointment, use "reschedule"
7. If the user is asking about cancelling, use "cancel"
8. If the user is asking what to bring/prepare, use "what_to_prepare"
9. If the user is asking about available times, use "check_availability"

Your response must be exactly one of these 5 words: book_new, reschedule, cancel, what_to_prepare, check_availability`;

  const messages = [
    { role: 'user', content: `Classify this user input into one of the 5 categories:\n\n"${userInput}"` }
  ];

  try {
    const response = await getAIResponse(systemPrompt, messages);
    let intent = response.content.trim().toLowerCase();
    
    // Aggressive cleaning of LLM response variations
    intent = intent
      // Remove common prefixes
      .replace(/^(the\s+)?(intent\s+is\s*:?\s*)/i, '')
      .replace(/^(it\s+is\s+)/i, '')
      .replace(/^(this\s+is\s+)/i, '')
      .replace(/^(classified\s+as\s*:?\s*)/i, '')
      .replace(/^(category\s*:?\s*)/i, '')
      // Remove quotes
      .replace(/^["']|["']$/g, '')
      // Remove markdown code blocks
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`/g, '')
      // Remove numbers and bullets
      .replace(/^\d+[\.\)]\s*/i, '')
      .replace(/^[-*]\s*/i, '')
      // Remove trailing punctuation and whitespace
      .replace(/[.,;!?\n\r].*$/, '')
      .trim();
    
    // Try to find intent in the cleaned string
    for (const validIntent of validIntents) {
      if (intent === validIntent || intent.includes(validIntent)) {
        logger.log('llm', `Intent classified: ${validIntent}`, { 
          userInput, 
          intent: validIntent,
          method: 'llm',
          rawResponse: response.content 
        });
        return validIntent;
      }
    }
    
    // If still not found and we have retries left, try again with a more explicit prompt
    if (retryCount < MAX_RETRIES) {
      logger.log('llm', `Intent classification unclear, retrying (attempt ${retryCount + 1}/${MAX_RETRIES})`, { userInput });
      return await classifyIntent(userInput, retryCount + 1);
    }
    
    // Last resort: try to extract intent from response using pattern matching
    const intentPattern = new RegExp(`\\b(${validIntents.join('|')})\\b`, 'i');
    const match = intent.match(intentPattern);
    if (match) {
      const matchedIntent = match[1].toLowerCase();
      logger.log('llm', `Intent classified via pattern matching: ${matchedIntent}`, { 
        userInput, 
        intent: matchedIntent,
        method: 'llm_pattern' 
      });
      return matchedIntent;
    }
    
    // If LLM response is unclear, use keyword classifier as fallback
    logger.log('fallback', `LLM response unclear, using keyword classifier`, { userInput });
    const keywordIntent = classifyIntentWithKeywords(userInput);
    logger.log('keyword', `Intent classified via keywords: ${keywordIntent}`, { 
      userInput, 
      intent: keywordIntent,
      method: 'keyword' 
    });
    return keywordIntent;
    
  } catch (error) {
    logger.log('error', `Intent classification error: ${error.message}`, { userInput, error: error.message });
    
    // Check if this is a rate limit or API error that should trigger keyword fallback
    if (shouldUseKeywordFallback(error)) {
      if (isRateLimitError(error)) {
        logger.log('rate_limit', `Rate limit hit, using keyword classifier fallback`, { userInput });
      } else {
        logger.log('fallback', `API error detected, using keyword classifier fallback`, { userInput, error: error.message });
      }
      const keywordIntent = classifyIntentWithKeywords(userInput);
      logger.log('keyword', `Intent classified via keywords (fallback): ${keywordIntent}`, { 
        userInput, 
        intent: keywordIntent,
        method: 'keyword_fallback' 
      });
      return keywordIntent;
    }
    
    // Retry for non-rate-limit errors
    if (retryCount < MAX_RETRIES && !isRateLimitError(error)) {
      logger.log('llm', `Retrying intent classification (attempt ${retryCount + 1}/${MAX_RETRIES})`, { userInput });
      await new Promise(resolve => setTimeout(resolve, 500 * (retryCount + 1))); // Progressive delay
      return await classifyIntent(userInput, retryCount + 1);
    }
    
    // Final fallback: use keyword classifier
    logger.log('fallback', `LLM classification failed after retries, using keyword classifier`, { userInput });
    const keywordIntent = classifyIntentWithKeywords(userInput);
    logger.log('keyword', `Intent classified via keywords (final fallback): ${keywordIntent}`, { 
      userInput, 
      intent: keywordIntent,
      method: 'keyword_fallback' 
    });
    return keywordIntent;
  }
}

/**
 * Extract slots from user input
 * @param {string} userInput - User's input text
 * @param {string} intent - Current intent
 * @returns {Promise<Object>} Extracted slots
 */
export async function extractSlots(userInput, intent) {
  // Skip API calls in test environment - return empty slots
  if (IS_TEST_ENV) {
    console.log(`⚠️  Test environment: Skipping Groq API call for slot extraction. Returning empty slots.`);
    logger.log('keyword', `Slot extraction skipped (test mode)`, { 
      userInput, 
      intent,
      method: 'test_mode' 
    });
    return {};
  }

  const systemPrompt = `You are a slot extractor for an advisor appointment scheduling system.

Extract relevant information from the user's input based on the intent: ${intent}

For book_new intent, extract:
- topic: One of exactly these: "KYC/Onboarding", "SIP/Mandates", "Statements/Tax Docs", "Withdrawals & Timelines", "Account Changes/Nominee" (or null if not found)
- preferred_day: Day preference as string (e.g., "today", "tomorrow", "Monday", "next week") or null
- preferred_time_window: Time preference as string (e.g., "morning", "afternoon", "evening", "any") or null

For reschedule intent, extract:
- booking_code: Booking code in format XX-XXX or XX-XXXX (e.g., "NL-A742") or null
- new_preferred_day: New day preference as string or null
- new_preferred_time_window: New time preference as string or null

For cancel intent, extract:
- booking_code: Booking code in format XX-XXX or XX-XXXX or null

For what_to_prepare intent, extract:
- topic: One of the 5 topics or null

For check_availability intent, extract:
- day_range: Time range as string (e.g., "today", "tomorrow", "this week") or null

IMPORTANT: Respond with ONLY a valid JSON object. Use null for missing values. Example format:
{"topic": "Account Changes/Nominee", "preferred_day": "tomorrow", "preferred_time_window": "afternoon"}`;

  const messages = [
    { role: 'user', content: `Extract slots from: "${userInput}"` }
  ];

  try {
    const response = await getAIResponse(systemPrompt, messages);
    const content = response.content.trim();
    
    // Try to parse JSON from response - handle code blocks
    let jsonString = content;
    
    // Remove markdown code blocks if present
    jsonString = jsonString.replace(/```json\n?/g, '');
    jsonString = jsonString.replace(/```\n?/g, '');
    jsonString = jsonString.trim();
    
    // Try to find JSON object
    const jsonMatch = jsonString.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return parsed;
      } catch (parseError) {
        console.warn('Failed to parse JSON, trying to fix:', parseError.message);
        // Try to fix common JSON issues
        let fixedJson = jsonMatch[0]
          .replace(/'/g, '"')  // Replace single quotes with double quotes
          .replace(/(\w+):/g, '"$1":'); // Add quotes to keys if missing
        try {
          return JSON.parse(fixedJson);
        } catch (e) {
          console.error('Could not fix JSON:', e.message);
        }
      }
    }
    
    return {};
  } catch (error) {
    console.error('Slot extraction error:', error);
    return {};
  }
}

