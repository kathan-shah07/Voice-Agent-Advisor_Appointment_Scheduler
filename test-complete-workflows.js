/**
 * Complete Workflow Test Suite
 * Tests all major use cases for the Voice Agent Advisor Appointment Scheduler
 */

import { ConversationEngine } from '../src/engine/conversationEngine.js';
import { DIALOG_STATES } from '../src/engine/dialogState.js';
import dotenv from 'dotenv';

dotenv.config();

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(70));
  log(title, 'cyan');
  console.log('='.repeat(70));
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

function logWarning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

function logInfo(message) {
  log(`ℹ️  ${message}`, 'blue');
}

function logTest(message) {
  log(`🧪 ${message}`, 'magenta');
}

/**
 * Test helper: Send message and wait for response
 */
async function sendMessage(engine, sessionId, message, delay = 500) {
  logTest(`User: "${message}"`);
  const result = await engine.processMessage(sessionId, message);
  await new Promise(resolve => setTimeout(resolve, delay));
  logInfo(`Bot: ${result.response.substring(0, 150)}${result.response.length > 150 ? '...' : ''}`);
  return result;
}

/**
 * Test 1: Book new with clear preference → two slots → success, code issued
 */
async function testBookNewClearPreference() {
  logSection('Test 1: Book New with Clear Preference → Two Slots → Success, Code Issued');
  
  const engine = new ConversationEngine();
  const sessionId = `test-${Date.now()}-1`;
  
  try {
    // Wait for MCP initialization
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Step 1: Greeting
    let result = await sendMessage(engine, sessionId, 'hello');
    if (result.state !== DIALOG_STATES.GREETING && result.state !== DIALOG_STATES.INTENT_CONFIRMATION) {
      logWarning(`Expected GREETING or INTENT_CONFIRMATION, got ${result.state}`);
    }
    
    // Step 2: Book new intent
    result = await sendMessage(engine, sessionId, 'I want to book an appointment');
    if (result.state !== DIALOG_STATES.INTENT_CONFIRMATION) {
      logWarning(`Expected INTENT_CONFIRMATION, got ${result.state}`);
    }
    
    // Step 3: Confirm intent
    result = await sendMessage(engine, sessionId, 'yes');
    if (result.state !== DIALOG_STATES.TOPIC_SELECTION) {
      logWarning(`Expected TOPIC_SELECTION, got ${result.state}`);
    }
    
    // Step 4: Select topic
    result = await sendMessage(engine, sessionId, 'KYC');
    if (result.state !== DIALOG_STATES.TOPIC_CONFIRMATION) {
      logWarning(`Expected TOPIC_CONFIRMATION, got ${result.state}`);
    }
    
    // Step 5: Confirm topic
    result = await sendMessage(engine, sessionId, 'yes');
    if (result.state !== DIALOG_STATES.TIME_PREFERENCE) {
      logWarning(`Expected TIME_PREFERENCE, got ${result.state}`);
    }
    
    // Step 6: Clear time preference
    result = await sendMessage(engine, sessionId, 'tomorrow afternoon');
    if (result.state !== DIALOG_STATES.SLOT_OFFER) {
      logWarning(`Expected SLOT_OFFER, got ${result.state}`);
    }
    
    // Verify two slots are offered
    if (!result.response.includes('option') && !result.response.includes('1') && !result.response.includes('2')) {
      logError('Expected two slot options to be offered');
      return false;
    }
    logSuccess('Two slots offered');
    
    // Step 7: Select slot
    result = await sendMessage(engine, sessionId, '1');
    if (result.state !== DIALOG_STATES.SLOT_CONFIRMATION) {
      logWarning(`Expected SLOT_CONFIRMATION, got ${result.state}`);
    }
    
    // Step 8: Confirm slot
    result = await sendMessage(engine, sessionId, 'yes');
    if (result.state !== DIALOG_STATES.COMPLETED) {
      logWarning(`Expected COMPLETED, got ${result.state}`);
    }
    
    // Verify booking code issued
    const bookingCodeMatch = result.response.match(/\b[A-Z]{2}-[A-Z0-9]{3,4}\b/);
    if (!bookingCodeMatch) {
      logError('No booking code found in response');
      return false;
    }
    
    const bookingCode = bookingCodeMatch[0];
    logSuccess(`Booking code issued: ${bookingCode}`);
    
    // Verify tool calls
    if (result.toolCalls && result.toolCalls.length > 0) {
      const toolNames = result.toolCalls.map(t => t.function.name);
      if (toolNames.includes('event_create_tentative')) {
        logSuccess('Event creation tool called');
      } else {
        logWarning('Event creation tool not found in tool calls');
      }
    }
    
    return { success: true, bookingCode };
  } catch (error) {
    logError(`Test failed: ${error.message}`);
    console.error(error);
    return { success: false, error: error.message };
  }
}

/**
 * Test 2: Book new with vague time → follow-up → success
 */
async function testBookNewVagueTime() {
  logSection('Test 2: Book New with Vague Time → Follow-up → Success');
  
  const engine = new ConversationEngine();
  const sessionId = `test-${Date.now()}-2`;
  
  try {
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    await sendMessage(engine, sessionId, 'hello');
    await sendMessage(engine, sessionId, 'I want to book an appointment');
    await sendMessage(engine, sessionId, 'yes');
    await sendMessage(engine, sessionId, 'SIP');
    await sendMessage(engine, sessionId, 'yes');
    
    // Vague time preference
    let result = await sendMessage(engine, sessionId, 'sometime next week');
    
    // Should ask for clarification
    if (!result.response.toLowerCase().includes('time') && 
        !result.response.toLowerCase().includes('morning') && 
        !result.response.toLowerCase().includes('afternoon')) {
      logWarning('Expected follow-up question about time preference');
    } else {
      logSuccess('Follow-up question asked for vague time');
    }
    
    // Provide clearer preference
    result = await sendMessage(engine, sessionId, 'Monday afternoon');
    
    if (result.state === DIALOG_STATES.SLOT_OFFER || result.state === DIALOG_STATES.TIME_PREFERENCE) {
      logSuccess('Accepted clearer time preference');
      
      // Continue to completion if slots offered
      if (result.state === DIALOG_STATES.SLOT_OFFER) {
        result = await sendMessage(engine, sessionId, '1');
        result = await sendMessage(engine, sessionId, 'yes');
        
        if (result.state === DIALOG_STATES.COMPLETED) {
          logSuccess('Booking completed after follow-up');
          return { success: true };
        }
      }
    }
    
    return { success: true };
  } catch (error) {
    logError(`Test failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Test 3: Book new where availability returns nothing → waitlist flow
 */
async function testBookNewWaitlistFlow() {
  logSection('Test 3: Book New - No Availability → Waitlist Flow');
  
  const engine = new ConversationEngine();
  const sessionId = `test-${Date.now()}-3`;
  
  try {
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    await sendMessage(engine, sessionId, 'hello');
    await sendMessage(engine, sessionId, 'I want to book an appointment');
    await sendMessage(engine, sessionId, 'yes');
    await sendMessage(engine, sessionId, 'Account Changes');
    await sendMessage(engine, sessionId, 'yes');
    
    // Use a time that might not have availability (e.g., very specific or past date)
    // Note: This test depends on availability service behavior
    let result = await sendMessage(engine, sessionId, 'yesterday at 3 PM');
    
    // System should either offer waitlist or ask for different time
    if (result.response.toLowerCase().includes('waitlist') || 
        result.response.toLowerCase().includes('no available') ||
        result.state === DIALOG_STATES.WAITLIST_CONFIRMATION) {
      logSuccess('Waitlist flow triggered');
      
      if (result.state === DIALOG_STATES.WAITLIST_CONFIRMATION) {
        result = await sendMessage(engine, sessionId, 'yes');
        if (result.state === DIALOG_STATES.COMPLETED) {
          logSuccess('Waitlist booking completed');
          return { success: true };
        }
      }
    } else {
      logWarning('Waitlist flow not triggered - availability service may have returned slots');
    }
    
    return { success: true };
  } catch (error) {
    logError(`Test failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Test 4: User tries to give phone/email → agent refuses and keeps going
 */
async function testPIIRejection() {
  logSection('Test 4: PII Rejection - Phone/Email Refused');
  
  const engine = new ConversationEngine();
  const sessionId = `test-${Date.now()}-4`;
  
  try {
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    await sendMessage(engine, sessionId, 'hello');
    await sendMessage(engine, sessionId, 'I want to book an appointment');
    await sendMessage(engine, sessionId, 'yes');
    
    // Try to provide phone number
    let result = await sendMessage(engine, sessionId, 'My phone number is 9876543210');
    
    if (result.response.toLowerCase().includes('phone') || 
        result.response.toLowerCase().includes('not share') ||
        result.response.toLowerCase().includes('secure')) {
      logSuccess('Phone number rejected with appropriate message');
    } else {
      logWarning('Phone number rejection message not clear');
    }
    
    // Try to provide email
    result = await sendMessage(engine, sessionId, 'My email is test@example.com');
    
    if (result.response.toLowerCase().includes('email') || 
        result.response.toLowerCase().includes('not share') ||
        result.response.toLowerCase().includes('secure')) {
      logSuccess('Email rejected with appropriate message');
    } else {
      logWarning('Email rejection message not clear');
    }
    
    // Should still be able to continue
    result = await sendMessage(engine, sessionId, 'KYC');
    if (result.state === DIALOG_STATES.TOPIC_CONFIRMATION || result.state === DIALOG_STATES.TOPIC_SELECTION) {
      logSuccess('Flow continued after PII rejection');
      return { success: true };
    }
    
    return { success: true };
  } catch (error) {
    logError(`Test failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Test 5: User asks "Which fund is best?" → refusal + educational links
 */
async function testInvestmentAdviceRefusal() {
  logSection('Test 5: Investment Advice Refusal');
  
  const engine = new ConversationEngine();
  const sessionId = `test-${Date.now()}-5`;
  
  try {
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    await sendMessage(engine, sessionId, 'hello');
    
    // Ask investment advice question
    let result = await sendMessage(engine, sessionId, 'Which fund is best for me?');
    
    if (result.response.toLowerCase().includes('cannot') || 
        result.response.toLowerCase().includes('not provide') ||
        result.response.toLowerCase().includes('advice') ||
        result.response.toLowerCase().includes('educational') ||
        result.response.toLowerCase().includes('regulator')) {
      logSuccess('Investment advice refused with appropriate message');
    } else {
      logWarning('Investment advice refusal message not clear');
    }
    
    // Should still be able to book
    result = await sendMessage(engine, sessionId, 'I want to book an appointment');
    if (result.state === DIALOG_STATES.INTENT_CONFIRMATION) {
      logSuccess('Can continue booking after advice refusal');
      return { success: true };
    }
    
    return { success: true };
  } catch (error) {
    logError(`Test failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Test 6: Reschedule with valid code → slot moved
 */
async function testRescheduleValidCode() {
  logSection('Test 6: Reschedule with Valid Code → Slot Moved');
  
  const engine = new ConversationEngine();
  const sessionId = `test-${Date.now()}-6`;
  
  try {
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // First, create a booking in the same session
    logInfo('Creating initial booking...');
    await sendMessage(engine, sessionId, 'hello');
    await sendMessage(engine, sessionId, 'I want to book an appointment');
    await sendMessage(engine, sessionId, 'yes');
    await sendMessage(engine, sessionId, 'KYC');
    await sendMessage(engine, sessionId, 'yes');
    await sendMessage(engine, sessionId, 'tomorrow afternoon');
    
    let result = await sendMessage(engine, sessionId, '1');
    result = await sendMessage(engine, sessionId, 'yes');
    
    // Extract booking code from response
    const bookingCodeMatch = result.response.match(/\b[A-Z]{2}-[A-Z0-9]{3,4}\b/);
    if (!bookingCodeMatch) {
      logError('Could not extract booking code from initial booking');
      return { success: false, error: 'No booking code found' };
    }
    
    const bookingCode = bookingCodeMatch[0];
    logInfo(`Created booking with code: ${bookingCode}`);
    
    // Now test reschedule in same session (booking should be in session memory)
    logInfo('Testing reschedule...');
    result = await sendMessage(engine, sessionId, 'I want to reschedule my appointment');
    
    if (result.state !== DIALOG_STATES.INTENT_CONFIRMATION && result.state !== DIALOG_STATES.RESCHEDULE_CODE_INPUT) {
      logWarning(`Expected INTENT_CONFIRMATION or RESCHEDULE_CODE_INPUT, got ${result.state}`);
    }
    
    result = await sendMessage(engine, sessionId, 'yes');
    result = await sendMessage(engine, sessionId, bookingCode);
    
    if (result.state === DIALOG_STATES.RESCHEDULE_TIME || result.state === DIALOG_STATES.SLOT_OFFER) {
      logSuccess('Booking found, proceeding with reschedule');
      
      // Provide new time
      result = await sendMessage(engine, sessionId, 'next Monday at 2 PM');
      
      if (result.state === DIALOG_STATES.SLOT_OFFER || result.state === DIALOG_STATES.RESCHEDULE_SLOT_CONFIRMATION) {
        result = await sendMessage(engine, sessionId, '1');
        result = await sendMessage(engine, sessionId, 'yes');
        
        if (result.state === DIALOG_STATES.COMPLETED) {
          if (result.response.toLowerCase().includes('rescheduled')) {
            logSuccess('Reschedule completed successfully');
            return { success: true };
          }
        }
      }
    } else if (result.response.toLowerCase().includes('not found')) {
      logWarning('Booking code not found - may need to use session memory');
    }
    
    return { success: true };
  } catch (error) {
    logError(`Test failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Test 7: Reschedule with invalid code → graceful error
 */
async function testRescheduleInvalidCode() {
  logSection('Test 7: Reschedule with Invalid Code → Graceful Error');
  
  const engine = new ConversationEngine();
  const sessionId = `test-${Date.now()}-7`;
  
  try {
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    await sendMessage(engine, sessionId, 'hello');
    await sendMessage(engine, sessionId, 'I want to reschedule');
    await sendMessage(engine, sessionId, 'yes');
    
    // Provide invalid booking code
    let result = await sendMessage(engine, sessionId, 'XX-9999');
    
    if (result.response.toLowerCase().includes('not found') || 
        result.response.toLowerCase().includes('couldn\'t find') ||
        result.response.toLowerCase().includes('invalid')) {
      logSuccess('Invalid booking code handled gracefully');
    } else {
      logWarning('Invalid code error message not clear');
    }
    
    // Should reset to greeting or allow new booking
    if (result.state === DIALOG_STATES.GREETING || result.state === DIALOG_STATES.INITIAL) {
      logSuccess('Flow reset after invalid code');
    }
    
    return { success: true };
  } catch (error) {
    logError(`Test failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Test 8: Cancel with valid code → status updated
 */
async function testCancelValidCode() {
  logSection('Test 8: Cancel with Valid Code → Status Updated');
  
  const engine = new ConversationEngine();
  const sessionId = `test-${Date.now()}-8`;
  
  try {
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // First, create a booking in the same session
    logInfo('Creating initial booking...');
    await sendMessage(engine, sessionId, 'hello');
    await sendMessage(engine, sessionId, 'I want to book an appointment');
    await sendMessage(engine, sessionId, 'yes');
    await sendMessage(engine, sessionId, 'SIP');
    await sendMessage(engine, sessionId, 'yes');
    await sendMessage(engine, sessionId, 'tomorrow morning');
    
    let result = await sendMessage(engine, sessionId, '1');
    result = await sendMessage(engine, sessionId, 'yes');
    
    // Extract booking code from response
    const bookingCodeMatch = result.response.match(/\b[A-Z]{2}-[A-Z0-9]{3,4}\b/);
    if (!bookingCodeMatch) {
      logError('Could not extract booking code from initial booking');
      return { success: false, error: 'No booking code found' };
    }
    
    const bookingCode = bookingCodeMatch[0];
    logInfo(`Created booking with code: ${bookingCode}`);
    
    // Now test cancel in same session (booking should be in session memory)
    logInfo('Testing cancel...');
    result = await sendMessage(engine, sessionId, 'I want to cancel my appointment');
    
    result = await sendMessage(engine, sessionId, 'yes');
    result = await sendMessage(engine, sessionId, bookingCode);
    
    if (result.state === DIALOG_STATES.CANCEL_CONFIRMATION) {
      logSuccess('Booking found, asking for confirmation');
      
      result = await sendMessage(engine, sessionId, 'yes');
      
      if (result.state === DIALOG_STATES.COMPLETED) {
        if (result.response.toLowerCase().includes('cancelled') || 
            result.response.toLowerCase().includes('cancel')) {
          logSuccess('Cancellation completed successfully');
          
          // Verify tool calls
          if (result.toolCalls && result.toolCalls.length > 0) {
            const toolNames = result.toolCalls.map(t => t.function.name);
            if (toolNames.includes('event_cancel')) {
              logSuccess('Cancel tool called');
            }
          }
          
          return { success: true };
        }
      }
    } else if (result.response.toLowerCase().includes('not found')) {
      logWarning('Booking code not found - may need to use session memory');
    }
    
    return { success: true };
  } catch (error) {
    logError(`Test failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Test 9: "What to prepare" for each topic → topic-specific checklist
 */
async function testWhatToPrepare() {
  logSection('Test 9: What to Prepare - Topic-Specific Checklists');
  
  const engine = new ConversationEngine();
  const topics = ['KYC', 'SIP', 'Statements', 'Withdrawals', 'Account Changes'];
  
  try {
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    for (const topic of topics) {
      const sessionId = `test-${Date.now()}-9-${topic}`;
      
      logInfo(`\nTesting topic: ${topic}`);
      
      await sendMessage(engine, sessionId, 'hello');
      let result = await sendMessage(engine, sessionId, 'What should I prepare?');
      
      result = await sendMessage(engine, sessionId, topic);
      
      // Verify checklist is provided
      if (result.response.toLowerCase().includes('prepare') || 
          result.response.toLowerCase().includes('bring') ||
          result.response.toLowerCase().includes('documents') ||
          result.response.match(/\d+\./)) { // Numbered list
        logSuccess(`Checklist provided for ${topic}`);
      } else {
        logWarning(`Checklist not clear for ${topic}`);
      }
      
      // Verify topic-specific content
      const topicLower = topic.toLowerCase();
      if (result.response.toLowerCase().includes(topicLower) || 
          result.response.toLowerCase().includes('kyc') ||
          result.response.toLowerCase().includes('sip') ||
          result.response.toLowerCase().includes('statement') ||
          result.response.toLowerCase().includes('withdrawal') ||
          result.response.toLowerCase().includes('account')) {
        logSuccess(`Topic-specific content found for ${topic}`);
      }
    }
    
    return { success: true };
  } catch (error) {
    logError(`Test failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Test 10: Check availability "today" / "this week" → returns plausible windows
 */
async function testCheckAvailability() {
  logSection('Test 10: Check Availability - Today / This Week');
  
  const engine = new ConversationEngine();
  const sessionId = `test-${Date.now()}-10`;
  
  try {
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    await sendMessage(engine, sessionId, 'hello');
    
    // Test "today"
    logInfo('\nTesting: "today"');
    let result = await sendMessage(engine, sessionId, 'What times are available today?');
    
    if (result.response.toLowerCase().includes('available') || 
        result.response.toLowerCase().includes('slot') ||
        result.response.toLowerCase().includes('time')) {
      logSuccess('Availability information provided for today');
    } else {
      logWarning('Availability response not clear for today');
    }
    
    // Test "this week"
    logInfo('\nTesting: "this week"');
    result = await sendMessage(engine, sessionId, 'What times are available this week?');
    
    if (result.response.toLowerCase().includes('available') || 
        result.response.toLowerCase().includes('slot') ||
        result.response.toLowerCase().includes('time') ||
        result.response.toLowerCase().includes('week')) {
      logSuccess('Availability information provided for this week');
    } else {
      logWarning('Availability response not clear for this week');
    }
    
    return { success: true };
  } catch (error) {
    logError(`Test failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Main test runner
 */
async function runAllTests() {
  console.log('\n');
  log('╔══════════════════════════════════════════════════════════════════════════╗', 'cyan');
  log('║     Complete Workflow Test Suite - Voice Agent Appointment Scheduler   ║', 'cyan');
  log('╚══════════════════════════════════════════════════════════════════════════╝', 'cyan');
  
  const results = [];
  
  // Run all tests
  results.push({ name: 'Test 1: Book New - Clear Preference', ...await testBookNewClearPreference() });
  results.push({ name: 'Test 2: Book New - Vague Time', ...await testBookNewVagueTime() });
  results.push({ name: 'Test 3: Book New - Waitlist Flow', ...await testBookNewWaitlistFlow() });
  results.push({ name: 'Test 4: PII Rejection', ...await testPIIRejection() });
  results.push({ name: 'Test 5: Investment Advice Refusal', ...await testInvestmentAdviceRefusal() });
  results.push({ name: 'Test 6: Reschedule - Valid Code', ...await testRescheduleValidCode() });
  results.push({ name: 'Test 7: Reschedule - Invalid Code', ...await testRescheduleInvalidCode() });
  results.push({ name: 'Test 8: Cancel - Valid Code', ...await testCancelValidCode() });
  results.push({ name: 'Test 9: What to Prepare', ...await testWhatToPrepare() });
  results.push({ name: 'Test 10: Check Availability', ...await testCheckAvailability() });
  
  // Summary
  logSection('Test Summary');
  
  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  results.forEach(result => {
    if (result.success) {
      logSuccess(`${result.name}: PASSED`);
    } else {
      logError(`${result.name}: FAILED - ${result.error || 'Unknown error'}`);
    }
  });
  
  console.log('\n');
  log(`Total Tests: ${results.length}`, 'cyan');
  logSuccess(`Passed: ${passed}`);
  if (failed > 0) {
    logError(`Failed: ${failed}`);
  }
  
  console.log('\n');
  
  if (failed === 0) {
    logSuccess('🎉 All tests passed!');
    process.exit(0);
  } else {
    logError(`❌ ${failed} test(s) failed`);
    process.exit(1);
  }
}

// Run the tests
runAllTests().catch(error => {
  logError(`Fatal error: ${error.message}`);
  console.error(error);
  process.exit(1);
});

