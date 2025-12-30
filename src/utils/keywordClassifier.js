/**
 * Keyword-Based Intent Classifier
 * Fallback classifier when LLM API fails or hits rate limits
 */

import { INTENTS } from '../config/constants.js';

/**
 * Comprehensive keyword patterns for each intent
 */
const KEYWORD_PATTERNS = {
  [INTENTS.BOOK_NEW]: {
    primary: [
      /\b(book|schedule)\s+(a|an|the)?\s*(new\s+)?(appointment|consultation|call|meeting|slot)/i,
      /\b(i\s+want|i\s+need|i\s+would\s+like|i\s+'d\s+like|can\s+i)\s+(to\s+)?(book|schedule)\s+(a|an)?\s*(appointment|call|meeting|slot)/i,
      /\b(set\s+up|arrange|organize)\s+(a|an|the)?\s*(new\s+)?(appointment|call|meeting|consultation)/i,
      /\b(new\s+)?(appointment|booking)\s+(please|for|with)/i
    ],
    secondary: [
      /\b(talk|speak|discuss|meet)\s+(with|to)\s+(an?\s+)?(advisor|consultant|expert)\s+(?!when|available|free)/i,
      /\b(need|want|looking\s+for)\s+(an?\s+)?(appointment|booking|slot|call)/i,
      /\b(book|schedule|appointment|slot)\b/i
    ]
  },
  [INTENTS.RESCHEDULE]: {
    primary: [
      /\b(reschedule|re-schedule|re\s+schedule)\b/i,
      /\b(change|modify|move|shift|adjust)\s+(my|the)?\s*(appointment|booking|slot|call|meeting|time)/i,
      /\b(change|modify|move|shift|adjust)\s+(appointment|booking|slot|call|meeting)\s+(time|date|schedule)/i
    ],
    secondary: [
      /\b(different|another|other)\s+(time|date|day|slot)/i,
      /\b(can\s+i|i\s+want\s+to|i\s+need\s+to)\s+(change|move|reschedule)/i
    ]
  },
  [INTENTS.CANCEL]: {
    primary: [
      /\b(cancel|cancellation|cancelling|cancelled)\b/i,
      /\b(remove|delete|drop)\s+(my|the)?\s*(appointment|booking|slot|call|meeting)/i,
      /\b(can't|cannot|won't|will\s+not)\s+(make\s+it|attend|come)/i
    ],
    secondary: [
      /\b(not\s+able|unable|can't)\s+(to\s+)?(make|attend|come|be\s+there)/i,
      /\b(please\s+)?(remove|delete|cancel)\s+(it|this|that|my\s+slot)/i
    ]
  },
  [INTENTS.WHAT_TO_PREPARE]: {
    primary: [
      /\b(what|which)\s+(should\s+i|do\s+i\s+need|to)\s+(prepare|bring|have|need|get)/i,
      /\b(prepare|preparation|preparing)\s+(for|what)/i,
      /\b(what|which)\s+(documents|papers|items|things)\s+(do\s+i\s+)?(need|require|should\s+bring)/i,
      /\b(preparation|prepare)\s+(checklist|list)/i
    ],
    secondary: [
      /\b(checklist|list)\s+(of|for)\s+(what|documents|items)/i,
      /\b(what\s+to|what\s+do\s+i)\s+(bring|prepare|have\s+ready)/i,
      /\b(required|needed)\s+(documents|papers|items)/i,
      /\b(prepare|preparation)\b/i
    ]
  },
  [INTENTS.CHECK_AVAILABILITY]: {
    primary: [
      /\b(when|what\s+times|what\s+time)\s+(are\s+you|is|are|can\s+i)\s+(available|free|open)/i,
      /\b(available|availability|free|open)\s+(slots|times|appointments|dates)/i,
      /\b(show|tell|give)\s+me\s+(available|free|open)\s+(slots|times|appointments)/i,
      /\b(when|what\s+times)\s+(can\s+i)?\s*(book|schedule|appointment)/i,
      /\bwhen\s+(can\s+i|are\s+you)\s+(speak|talk|available|free)/i
    ],
    secondary: [
      /\b(what|which)\s+(slots|times|dates)\s+(are\s+)?(available|free|open)/i,
      /\b(check|see|view)\s+(available|free|open)\s+(slots|times|appointments)/i,
      /\b(when|available|slots|times)\b/i
    ]
  }
};

/**
 * Score-based keyword classifier
 * @param {string} userInput - User's input text
 * @returns {string} Classified intent
 */
export function classifyIntentWithKeywords(userInput) {
  if (!userInput || typeof userInput !== 'string') {
    return INTENTS.BOOK_NEW; // Default
  }

  const normalizedInput = userInput.toLowerCase().trim();
  const intentScores = {};

  // Initialize scores
  Object.keys(KEYWORD_PATTERNS).forEach(intent => {
    intentScores[intent] = 0;
  });

  // Score each intent based on keyword matches
  // Process intents in order of specificity (most specific first)
  const intentOrder = [
    INTENTS.CANCEL,
    INTENTS.RESCHEDULE,
    INTENTS.WHAT_TO_PREPARE,
    INTENTS.CHECK_AVAILABILITY,
    INTENTS.BOOK_NEW // Most general, checked last
  ];

  for (const intent of intentOrder) {
    const patterns = KEYWORD_PATTERNS[intent];
    if (!patterns) continue;
    
    // Primary patterns have higher weight
    for (const pattern of patterns.primary || []) {
      if (pattern.test(normalizedInput)) {
        intentScores[intent] = (intentScores[intent] || 0) + 3;
      }
    }
    
    // Secondary patterns have lower weight
    for (const pattern of patterns.secondary || []) {
      if (pattern.test(normalizedInput)) {
        intentScores[intent] = (intentScores[intent] || 0) + 1;
      }
    }
  }

  // Find intent with highest score
  let maxScore = 0;
  let classifiedIntent = INTENTS.BOOK_NEW; // Default

  for (const [intent, score] of Object.entries(intentScores)) {
    if (score > maxScore) {
      maxScore = score;
      classifiedIntent = intent;
    }
  }

  // If no strong match (score < 2), default to book_new
  if (maxScore < 2) {
    return INTENTS.BOOK_NEW;
  }

  return classifiedIntent;
}

/**
 * Check if an error is a rate limit error
 * @param {Error} error - Error object
 * @returns {boolean}
 */
export function isRateLimitError(error) {
  if (!error) return false;
  
  const errorMessage = error.message?.toLowerCase() || '';
  const errorStatus = error.status || error.response?.status;
  
  // Check for rate limit indicators
  const rateLimitIndicators = [
    'rate limit',
    'rate_limit',
    'too many requests',
    '429',
    'quota',
    'limit exceeded',
    'throttle'
  ];
  
  // Check status code
  if (errorStatus === 429) {
    return true;
  }
  
  // Check error message
  return rateLimitIndicators.some(indicator => errorMessage.includes(indicator));
}

/**
 * Check if an error is an API error that should trigger fallback
 * @param {Error} error - Error object
 * @returns {boolean}
 */
export function shouldUseKeywordFallback(error) {
  if (!error) return false;
  
  // Use keyword fallback for:
  // 1. Rate limit errors
  // 2. API errors (4xx, 5xx)
  // 3. Network errors
  // 4. Timeout errors
  
  if (isRateLimitError(error)) {
    return true;
  }
  
  const errorStatus = error.status || error.response?.status;
  if (errorStatus >= 400 && errorStatus < 600) {
    return true;
  }
  
  const errorMessage = error.message?.toLowerCase() || '';
  const networkErrors = ['network', 'timeout', 'connection', 'econnrefused', 'enotfound'];
  if (networkErrors.some(err => errorMessage.includes(err))) {
    return true;
  }
  
  return false;
}

