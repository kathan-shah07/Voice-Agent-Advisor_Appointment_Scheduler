/**
 * Topic Taxonomy Mapping
 * Maps free-text user input to one of the 5 fixed topics
 */

import { TOPICS, TOPIC_LIST } from '../config/constants.js';

const TOPIC_KEYWORDS = {
  [TOPICS.KYC_ONBOARDING]: [
    'kyc', 'know your customer', 'onboarding', 'verification', 'identity',
    'document', 'aadhaar', 'pan', 'passport', 'address proof', 'new account'
  ],
  [TOPICS.SIP_MANDATES]: [
    'sip', 'systematic investment plan', 'mandate', 'auto debit', 'recurring',
    'monthly', 'installment', 'emi', 'automatic', 'standing instruction'
  ],
  [TOPICS.STATEMENTS_TAX]: [
    'statement', 'tax', 'document', 'form 16', 'itr', 'income tax',
    'transaction', 'history', 'report', 'consolidated', 'account statement'
  ],
  [TOPICS.WITHDRAWALS_TIMELINES]: [
    'withdrawal', 'withdraw', 'redeem', 'redemption', 'timeline', 'time',
    'when', 'how long', 'duration', 'process', 'fund transfer', 'money'
  ],
  [TOPICS.ACCOUNT_CHANGES]: [
    'nominee', 'nomination', 'change', 'update', 'modify', 'edit',
    'account change', 'address change', 'contact', 'details', 'update account'
  ]
};

/**
 * Map user input to a topic
 * @param {string} userInput - User's free-text input
 * @returns {string|null} Mapped topic or null if no match
 */
export function mapToTopic(userInput) {
  if (!userInput || typeof userInput !== 'string') {
    return null;
  }
  
  const normalized = userInput.toLowerCase().trim();
  
  // Count matches for each topic
  const topicScores = {};
  
  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    topicScores[topic] = keywords.reduce((score, keyword) => {
      if (normalized.includes(keyword)) {
        return score + 1;
      }
      return score;
    }, 0);
  }
  
  // Find topic with highest score
  const maxScore = Math.max(...Object.values(topicScores));
  
  if (maxScore === 0) {
    return null; // No match found
  }
  
  // Return topic with highest score
  for (const [topic, score] of Object.entries(topicScores)) {
    if (score === maxScore) {
      return topic;
    }
  }
  
  return null;
}

/**
 * Validate if a topic is in the allowed list
 * @param {string} topic - Topic to validate
 * @returns {boolean} True if valid
 */
export function isValidTopic(topic) {
  return TOPIC_LIST.includes(topic);
}

/**
 * Get topic display name for confirmation
 * @param {string} topic - Topic code
 * @returns {string} Display name
 */
export function getTopicDisplayName(topic) {
  return topic || 'Unknown';
}

