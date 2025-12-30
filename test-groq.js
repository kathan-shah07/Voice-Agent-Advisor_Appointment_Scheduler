/**
 * Test script for Groq AI integration
 * Run with: node test-groq.js
 */

import dotenv from 'dotenv';
import { classifyIntent, extractSlots } from './src/services/aiService.js';

dotenv.config();

async function testGroqIntegration() {
  console.log('🧪 Testing Groq AI Integration\n');
  console.log('='.repeat(60));
  
  // Check if API key is set
  if (!process.env.GROQ_API_KEY) {
    console.error('❌ ERROR: GROQ_API_KEY not found in environment variables');
    console.log('\nPlease set GROQ_API_KEY in your .env file');
    process.exit(1);
  }
  
  console.log(`✅ AI Provider: ${process.env.AI_PROVIDER || 'groq'}`);
  console.log(`✅ API Key: ${process.env.GROQ_API_KEY.substring(0, 10)}...`);
  console.log('='.repeat(60));
  console.log();

  // Test cases for intent classification
  const intentTestCases = [
    { input: 'I want to book an advisor call', expected: 'book_new' },
    { input: 'I need to schedule an appointment', expected: 'book_new' },
    { input: 'Can I reschedule my appointment?', expected: 'reschedule' },
    { input: 'I want to change my booking time', expected: 'reschedule' },
    { input: 'Cancel my appointment please', expected: 'cancel' },
    { input: 'What documents should I prepare?', expected: 'what_to_prepare' },
    { input: 'When can I speak to an advisor?', expected: 'check_availability' },
    { input: 'What slots are available this week?', expected: 'check_availability' }
  ];

  console.log('📋 Testing Intent Classification');
  console.log('-'.repeat(60));
  
  for (const testCase of intentTestCases) {
    try {
      const startTime = Date.now();
      const intent = await classifyIntent(testCase.input);
      const duration = Date.now() - startTime;
      
      const status = intent === testCase.expected ? '✅' : '⚠️';
      console.log(`${status} Input: "${testCase.input}"`);
      console.log(`   Expected: ${testCase.expected}, Got: ${intent} (${duration}ms)`);
      console.log();
    } catch (error) {
      console.error(`❌ Error testing: "${testCase.input}"`);
      console.error(`   ${error.message}`);
      console.log();
    }
  }

  console.log('='.repeat(60));
  console.log();

  // Test cases for slot extraction
  const slotTestCases = [
    {
      input: 'I need help with nominee changes',
      intent: 'book_new',
      description: 'Extract topic from book_new intent'
    },
    {
      input: 'I want to book for KYC onboarding tomorrow afternoon',
      intent: 'book_new',
      description: 'Extract topic, day, and time window'
    },
    {
      input: 'Reschedule NL-A742 to Monday morning',
      intent: 'reschedule',
      description: 'Extract booking code and new time preference'
    },
    {
      input: 'Cancel booking code AB-123',
      intent: 'cancel',
      description: 'Extract booking code from cancel intent'
    }
  ];

  console.log('📋 Testing Slot Extraction');
  console.log('-'.repeat(60));
  
  for (const testCase of slotTestCases) {
    try {
      const startTime = Date.now();
      const slots = await extractSlots(testCase.input, testCase.intent);
      const duration = Date.now() - startTime;
      
      console.log(`✅ Input: "${testCase.input}"`);
      console.log(`   Intent: ${testCase.intent}`);
      console.log(`   Extracted Slots:`, JSON.stringify(slots, null, 2));
      console.log(`   Duration: ${duration}ms`);
      console.log();
    } catch (error) {
      console.error(`❌ Error testing: "${testCase.input}"`);
      console.error(`   ${error.message}`);
      console.log();
    }
  }

  console.log('='.repeat(60));
  console.log('✅ Groq integration test completed!');
}

// Run tests
testGroqIntegration().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

