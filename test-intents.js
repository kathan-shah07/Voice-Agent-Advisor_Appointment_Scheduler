/**
 * Test script to verify all 5 intents work correctly
 * Run with: node test-intents.js
 */

import dotenv from 'dotenv';
import { ConversationEngine } from './src/engine/conversationEngine.js';

dotenv.config();

async function testAllIntents() {
  console.log('🧪 Testing All 5 Intents\n');
  console.log('='.repeat(70));
  
  const engine = new ConversationEngine('Test Brand', 'https://test.com/complete');
  
  // Test scenarios
  const testScenarios = [
    {
      name: '1. Book New Appointment',
      steps: [
        { input: 'hello', expectedIntent: null },
        { input: 'I want to book an advisor call', expectedIntent: 'book_new' },
        { input: 'I need help with nominee changes', expectedIntent: 'book_new' },
        { input: 'yes', expectedIntent: 'book_new' },
        { input: 'tomorrow afternoon', expectedIntent: 'book_new' },
        { input: '1', expectedIntent: 'book_new' },
        { input: 'yes', expectedIntent: 'book_new' }
      ]
    },
    {
      name: '2. Reschedule Appointment',
      steps: [
        { input: 'hello', expectedIntent: null },
        { input: 'I want to reschedule my appointment', expectedIntent: 'reschedule' },
        { input: 'NL-A742', expectedIntent: 'reschedule' },
        { input: 'Monday morning', expectedIntent: 'reschedule' },
        { input: '1', expectedIntent: 'reschedule' }
      ]
    },
    {
      name: '3. Cancel Appointment',
      steps: [
        { input: 'hello', expectedIntent: null },
        { input: 'Cancel my appointment', expectedIntent: 'cancel' },
        { input: 'NL-A742', expectedIntent: 'cancel' }
      ]
    },
    {
      name: '4. What to Prepare',
      steps: [
        { input: 'hello', expectedIntent: null },
        { input: 'What should I prepare for the meeting?', expectedIntent: 'what_to_prepare' },
        { input: 'KYC onboarding', expectedIntent: 'what_to_prepare' }
      ]
    },
    {
      name: '5. Check Availability',
      steps: [
        { input: 'hello', expectedIntent: null },
        { input: 'When can I speak to an advisor?', expectedIntent: 'check_availability' },
        { input: 'tomorrow', expectedIntent: 'check_availability' }
      ]
    }
  ];

  for (const scenario of testScenarios) {
    console.log(`\n${scenario.name}`);
    console.log('-'.repeat(70));
    
    const sessionId = `test-${scenario.name.toLowerCase().replace(/\s+/g, '-')}`;
    
    for (let i = 0; i < scenario.steps.length; i++) {
      const step = scenario.steps[i];
      try {
        const result = await engine.processInput(sessionId, step.input);
        
        const intentMatch = step.expectedIntent === null 
          ? result.intent === null 
          : result.intent === step.expectedIntent;
        
        const status = intentMatch ? '✅' : '❌';
        console.log(`${status} Step ${i + 1}: "${step.input}"`);
        console.log(`   Intent: ${result.intent || 'null'} (expected: ${step.expectedIntent || 'null'})`);
        console.log(`   State: ${result.state}`);
        if (result.toolCalls && result.toolCalls.length > 0) {
          console.log(`   Tool Calls: ${result.toolCalls.map(t => t.function.name).join(', ')}`);
        }
        console.log();
        
        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`❌ Error in step ${i + 1}:`, error.message);
        console.log();
      }
    }
  }

  console.log('='.repeat(70));
  console.log('✅ Intent testing completed!');
}

// Run tests
testAllIntents().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

