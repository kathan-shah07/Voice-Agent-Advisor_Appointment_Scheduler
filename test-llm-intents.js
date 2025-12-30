/**
 * Test LLM-based intent classification with various natural language inputs
 * Run with: node test-llm-intents.js
 */

import dotenv from 'dotenv';
import { classifyIntent } from './src/services/aiService.js';

dotenv.config();

async function testLLMIntentClassification() {
  console.log('🧪 Testing LLM-Based Intent Classification\n');
  console.log('='.repeat(70));
  
  // Check if API key is set
  if (!process.env.GROQ_API_KEY) {
    console.error('❌ ERROR: GROQ_API_KEY not found in environment variables');
    console.log('\nPlease set GROQ_API_KEY in your .env file');
    process.exit(1);
  }
  
  console.log(`✅ AI Provider: ${process.env.AI_PROVIDER || 'groq'}`);
  console.log(`✅ Model: ${process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'}`);
  console.log('='.repeat(70));
  console.log();

  // Comprehensive test cases with natural language variations
  const testCases = [
    {
      category: 'book_new',
      inputs: [
        'I want to book an advisor call',
        'Schedule me an appointment',
        'I need to talk to someone',
        'Can I get a slot?',
        'I\'d like to set up a meeting',
        'Book me a consultation',
        'I want to speak with an advisor',
        'Need to schedule something',
        'Can we arrange a call?',
        'I\'m looking to book',
        'Help me book an appointment',
        'I need an advisor consultation'
      ]
    },
    {
      category: 'reschedule',
      inputs: [
        'I want to reschedule my appointment',
        'Can I change my booking time?',
        'Move my appointment to another day',
        'I need to reschedule',
        'Change the time of my call',
        'Modify my booking',
        'Can we reschedule?',
        'I want to change when we meet',
        'Reschedule my slot please',
        'Move it to a different time',
        'I need to change my appointment'
      ]
    },
    {
      category: 'cancel',
      inputs: [
        'Cancel my appointment',
        'I can\'t make it',
        'Please cancel',
        'Remove my booking',
        'I need to cancel',
        'Delete my appointment',
        'Cancel the call',
        'I won\'t be able to make it',
        'Please remove my slot',
        'I want to cancel'
      ]
    },
    {
      category: 'what_to_prepare',
      inputs: [
        'What should I prepare?',
        'What documents do I need?',
        'What to bring for the meeting?',
        'What do I need to prepare?',
        'What should I have ready?',
        'Preparation checklist please',
        'What documents are required?',
        'What do I need for the call?',
        'Tell me what to prepare',
        'What should I bring?'
      ]
    },
    {
      category: 'check_availability',
      inputs: [
        'When can I speak to an advisor?',
        'What slots are available?',
        'Show me available times',
        'When are you free?',
        'What times work?',
        'When can I book?',
        'Show available slots',
        'What\'s available this week?',
        'When are advisors available?',
        'What times do you have?'
      ]
    }
  ];

  let totalTests = 0;
  let passedTests = 0;
  let failedTests = [];

  for (const testCategory of testCases) {
    console.log(`📋 Testing Category: ${testCategory.category.toUpperCase()}`);
    console.log('-'.repeat(70));
    
    for (const input of testCategory.inputs) {
      totalTests++;
      try {
        const startTime = Date.now();
        const intent = await classifyIntent(input);
        const duration = Date.now() - startTime;
        
        const passed = intent === testCategory.category;
        const status = passed ? '✅' : '❌';
        
        console.log(`${status} "${input}"`);
        console.log(`   Got: ${intent} | Expected: ${testCategory.category} (${duration}ms)`);
        
        if (passed) {
          passedTests++;
        } else {
          failedTests.push({
            input,
            expected: testCategory.category,
            got: intent
          });
        }
        
        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`❌ Error: "${input}" - ${error.message}`);
        failedTests.push({
          input,
          expected: testCategory.category,
          got: 'ERROR',
          error: error.message
        });
      }
    }
    console.log();
  }

  console.log('='.repeat(70));
  console.log('\n📊 Test Results:');
  console.log(`   Total Tests: ${totalTests}`);
  console.log(`   Passed: ${passedTests} (${((passedTests / totalTests) * 100).toFixed(1)}%)`);
  console.log(`   Failed: ${totalTests - passedTests} (${(((totalTests - passedTests) / totalTests) * 100).toFixed(1)}%)`);
  
  if (failedTests.length > 0) {
    console.log('\n❌ Failed Tests:');
    failedTests.forEach((test, index) => {
      console.log(`   ${index + 1}. "${test.input}"`);
      console.log(`      Expected: ${test.expected}, Got: ${test.got}`);
      if (test.error) {
        console.log(`      Error: ${test.error}`);
      }
    });
  } else {
    console.log('\n🎉 All tests passed! LLM-based intent classification is working perfectly!');
  }
  
  console.log('\n' + '='.repeat(70));
}

// Run tests
testLLMIntentClassification().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

