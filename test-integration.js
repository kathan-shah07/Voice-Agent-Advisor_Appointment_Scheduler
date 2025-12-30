/**
 * Integration Test Script for All Intents
 * Tests complete conversation flows from intent classification to execution
 * 
 * Run with: node test-integration.js
 */

import dotenv from 'dotenv';
import { ConversationEngine } from './src/engine/conversationEngine.js';
import { INTENTS } from './src/config/constants.js';
import { DIALOG_STATES } from './src/engine/dialogState.js';

dotenv.config();

const engine = new ConversationEngine('Test Advisor Desk', 'https://test.example.com/complete');

// Helper to simulate conversation
async function sendMessage(sessionId, message) {
  console.log(`\n👤 User: ${message}`);
  const result = await engine.processInput(sessionId, message);
  console.log(`🤖 AI: ${result.response}`);
  console.log(`   State: ${result.state} | Intent: ${result.intent || 'none'}`);
  if (result.toolCalls && result.toolCalls.length > 0) {
    console.log(`   🔧 Tool Calls: ${result.toolCalls.map(tc => tc.function.name).join(', ')}`);
  }
  return result;
}

// Helper to wait
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testBookNewFlow() {
  console.log('\n' + '='.repeat(80));
  console.log('TEST 1: Book New Appointment Flow');
  console.log('='.repeat(80));
  
  const sessionId = `test-book-${Date.now()}`;
  
  try {
    await sendMessage(sessionId, 'hello');
    await wait(500);
    
    await sendMessage(sessionId, 'I want to book an advisor call');
    await wait(500);
    
    await sendMessage(sessionId, 'yes');
    await wait(500);
    
    await sendMessage(sessionId, 'I need help with account changes');
    await wait(500);
    
    await sendMessage(sessionId, 'yes');
    await wait(500);
    
    await sendMessage(sessionId, 'tomorrow afternoon');
    await wait(500);
    
    const slotResult = await sendMessage(sessionId, '1');
    await wait(500);
    
    const finalResult = await sendMessage(sessionId, 'yes');
    
    // Verify completion
    if (finalResult.state === DIALOG_STATES.COMPLETED && finalResult.toolCalls && finalResult.toolCalls.length > 0) {
      console.log('\n✅ Book New Flow: PASSED');
      return true;
    } else {
      console.log('\n❌ Book New Flow: FAILED - Did not complete properly');
      return false;
    }
  } catch (error) {
    console.error('\n❌ Book New Flow: ERROR -', error.message);
    return false;
  }
}

async function testRescheduleFlow() {
  console.log('\n' + '='.repeat(80));
  console.log('TEST 2: Reschedule Appointment Flow');
  console.log('='.repeat(80));
  
  // First create a booking
  const bookSessionId = `test-book-reschedule-${Date.now()}`;
  let bookingCode = null;
  
  try {
    await sendMessage(bookSessionId, 'hello');
    await wait(500);
    await sendMessage(bookSessionId, 'book appointment');
    await wait(500);
    await sendMessage(bookSessionId, 'yes');
    await wait(500);
    await sendMessage(bookSessionId, 'statements tax');
    await wait(500);
    await sendMessage(bookSessionId, 'yes');
    await wait(500);
    await sendMessage(bookSessionId, 'tomorrow afternoon');
    await wait(500);
    await sendMessage(bookSessionId, '1');
    await wait(500);
    const bookResult = await sendMessage(bookSessionId, 'yes');
    
    // Extract booking code
    const codeMatch = bookResult.response.match(/\b[A-Z]{2}-[A-Z0-9]{3,4}\b/);
    if (codeMatch) {
      bookingCode = codeMatch[0];
      console.log(`\n📝 Created booking with code: ${bookingCode}`);
    } else {
      console.log('\n⚠️  Could not extract booking code, using test code');
      bookingCode = 'TS-R123';
    }
  } catch (error) {
    console.error('Error creating booking:', error.message);
    bookingCode = 'TS-R123'; // Fallback
  }
  
  // Now test reschedule
  const rescheduleSessionId = `test-reschedule-${Date.now()}`;
  
  try {
    await sendMessage(rescheduleSessionId, 'hello');
    await wait(500);
    
    await sendMessage(rescheduleSessionId, 'I want to reschedule my appointment');
    await wait(500);
    
    await sendMessage(rescheduleSessionId, 'yes');
    await wait(500);
    
    await sendMessage(rescheduleSessionId, bookingCode);
    await wait(500);
    
    await sendMessage(rescheduleSessionId, 'next Monday afternoon');
    await wait(500);
    
    const finalResult = await sendMessage(rescheduleSessionId, '1');
    
    if (finalResult.state === DIALOG_STATES.COMPLETED && finalResult.toolCalls && finalResult.toolCalls.length > 0) {
      console.log('\n✅ Reschedule Flow: PASSED');
      return true;
    } else {
      console.log('\n❌ Reschedule Flow: FAILED - Did not complete properly');
      return false;
    }
  } catch (error) {
    console.error('\n❌ Reschedule Flow: ERROR -', error.message);
    return false;
  }
}

async function testCancelFlow() {
  console.log('\n' + '='.repeat(80));
  console.log('TEST 3: Cancel Appointment Flow');
  console.log('='.repeat(80));
  
  // First create a booking
  const bookSessionId = `test-book-cancel-${Date.now()}`;
  let bookingCode = null;
  
  try {
    await sendMessage(bookSessionId, 'hello');
    await wait(500);
    await sendMessage(bookSessionId, 'book appointment');
    await wait(500);
    await sendMessage(bookSessionId, 'yes');
    await wait(500);
    await sendMessage(bookSessionId, 'withdrawals timelines');
    await wait(500);
    await sendMessage(bookSessionId, 'yes');
    await wait(500);
    await sendMessage(bookSessionId, 'tomorrow evening');
    await wait(500);
    await sendMessage(bookSessionId, '1');
    await wait(500);
    const bookResult = await sendMessage(bookSessionId, 'yes');
    
    const codeMatch = bookResult.response.match(/\b[A-Z]{2}-[A-Z0-9]{3,4}\b/);
    if (codeMatch) {
      bookingCode = codeMatch[0];
      console.log(`\n📝 Created booking with code: ${bookingCode}`);
    } else {
      bookingCode = 'TS-C123';
    }
  } catch (error) {
    console.error('Error creating booking:', error.message);
    bookingCode = 'TS-C123';
  }
  
  // Now test cancel
  const cancelSessionId = `test-cancel-${Date.now()}`;
  
  try {
    await sendMessage(cancelSessionId, 'hello');
    await wait(500);
    
    await sendMessage(cancelSessionId, 'cancel my appointment');
    await wait(500);
    
    await sendMessage(cancelSessionId, 'yes');
    await wait(500);
    
    const finalResult = await sendMessage(cancelSessionId, bookingCode);
    
    if (finalResult.state === DIALOG_STATES.COMPLETED && finalResult.toolCalls && finalResult.toolCalls.length > 0) {
      console.log('\n✅ Cancel Flow: PASSED');
      return true;
    } else {
      console.log('\n❌ Cancel Flow: FAILED - Did not complete properly');
      return false;
    }
  } catch (error) {
    console.error('\n❌ Cancel Flow: ERROR -', error.message);
    return false;
  }
}

async function testWhatToPrepareFlow() {
  console.log('\n' + '='.repeat(80));
  console.log('TEST 4: What to Prepare Flow');
  console.log('='.repeat(80));
  
  const sessionId = `test-prepare-${Date.now()}`;
  
  try {
    await sendMessage(sessionId, 'hello');
    await wait(500);
    
    await sendMessage(sessionId, 'what should I prepare for the meeting');
    await wait(500);
    
    await sendMessage(sessionId, 'yes');
    await wait(500);
    
    const finalResult = await sendMessage(sessionId, 'KYC onboarding');
    
    if (finalResult.state === DIALOG_STATES.COMPLETED && finalResult.response.includes('please prepare')) {
      console.log('\n✅ What to Prepare Flow: PASSED');
      return true;
    } else {
      console.log('\n❌ What to Prepare Flow: FAILED');
      return false;
    }
  } catch (error) {
    console.error('\n❌ What to Prepare Flow: ERROR -', error.message);
    return false;
  }
}

async function testCheckAvailabilityFlow() {
  console.log('\n' + '='.repeat(80));
  console.log('TEST 5: Check Availability Flow');
  console.log('='.repeat(80));
  
  const sessionId = `test-availability-${Date.now()}`;
  
  try {
    await sendMessage(sessionId, 'hello');
    await wait(500);
    
    await sendMessage(sessionId, 'when can I speak to an advisor');
    await wait(500);
    
    await sendMessage(sessionId, 'yes');
    await wait(500);
    
    const finalResult = await sendMessage(sessionId, 'today');
    
    if (finalResult.state === DIALOG_STATES.AVAILABILITY_CHECK && finalResult.response.includes('I have:')) {
      console.log('\n✅ Check Availability Flow: PASSED');
      return true;
    } else {
      console.log('\n❌ Check Availability Flow: FAILED');
      return false;
    }
  } catch (error) {
    console.error('\n❌ Check Availability Flow: ERROR -', error.message);
    return false;
  }
}

async function runAllTests() {
  console.log('\n🧪 Starting Integration Tests for All Intents');
  console.log('='.repeat(80));
  
  const results = {
    bookNew: false,
    reschedule: false,
    cancel: false,
    whatToPrepare: false,
    checkAvailability: false
  };
  
  try {
    results.bookNew = await testBookNewFlow();
    await wait(1000);
    
    results.reschedule = await testRescheduleFlow();
    await wait(1000);
    
    results.cancel = await testCancelFlow();
    await wait(1000);
    
    results.whatToPrepare = await testWhatToPrepareFlow();
    await wait(1000);
    
    results.checkAvailability = await testCheckAvailabilityFlow();
  } catch (error) {
    console.error('\n❌ Test execution error:', error);
  }
  
  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('TEST SUMMARY');
  console.log('='.repeat(80));
  console.log(`1. Book New Appointment:        ${results.bookNew ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`2. Reschedule Appointment:     ${results.reschedule ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`3. Cancel Appointment:         ${results.cancel ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`4. What to Prepare:             ${results.whatToPrepare ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`5. Check Availability:         ${results.checkAvailability ? '✅ PASSED' : '❌ FAILED'}`);
  
  const passed = Object.values(results).filter(r => r).length;
  const total = Object.keys(results).length;
  
  console.log('\n' + '='.repeat(80));
  console.log(`Total: ${passed}/${total} tests passed`);
  console.log('='.repeat(80));
  
  if (passed === total) {
    console.log('\n🎉 All integration tests passed!');
    process.exit(0);
  } else {
    console.log('\n⚠️  Some tests failed. Please review the output above.');
    process.exit(1);
  }
}

// Run tests
runAllTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

