/**
 * Application Constants
 */

export const TOPICS = {
  KYC_ONBOARDING: 'KYC/Onboarding',
  SIP_MANDATES: 'SIP/Mandates',
  STATEMENTS_TAX: 'Statements/Tax Docs',
  WITHDRAWALS_TIMELINES: 'Withdrawals & Timelines',
  ACCOUNT_CHANGES: 'Account Changes/Nominee'
};

export const TOPIC_LIST = Object.values(TOPICS);

export const INTENTS = {
  BOOK_NEW: 'book_new',
  RESCHEDULE: 'reschedule',
  CANCEL: 'cancel',
  WHAT_TO_PREPARE: 'what_to_prepare',
  CHECK_AVAILABILITY: 'check_availability'
};

export const TIME_WINDOWS = {
  MORNING: 'morning',      // 10:00 - 12:00 IST
  AFTERNOON: 'afternoon',  // 12:00 - 16:00 IST
  EVENING: 'evening',      // 16:00 - 18:00 IST
  ANY: 'any'               // 10:00 - 18:00 IST
};

export const TIME_WINDOW_RANGES = {
  [TIME_WINDOWS.MORNING]: { start: 10, end: 12 },
  [TIME_WINDOWS.AFTERNOON]: { start: 12, end: 16 },
  [TIME_WINDOWS.EVENING]: { start: 16, end: 18 },
  [TIME_WINDOWS.ANY]: { start: 10, end: 18 }
};

export const WORKING_DAYS = {
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6
};

export const WORKING_DAYS_LIST = Object.values(WORKING_DAYS);

export const SLOT_DURATION_MINUTES = 30;
export const WORKING_HOURS = { start: 10, end: 18 }; // 10:00 AM to 6:00 PM IST

export const BOOKING_CODE_PATTERN = /^[A-Z]{2}-[A-Z0-9]{3,4}$/;

export const PII_PATTERNS = {
  PHONE: /\b(?:\+91[\s-]?)?[6-9]\d{9}\b|\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/,
  EMAIL: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,
  ACCOUNT_NUMBER: /\b\d{10,}\b/
};

export const INVESTMENT_ADVICE_KEYWORDS = [
  'should i buy',
  'should i sell',
  'should i invest',
  'which fund',
  'best fund',
  'recommend',
  'investment advice',
  'what to invest',
  'good investment'
];

export const PREPARATION_GUIDES = {
  [TOPICS.KYC_ONBOARDING]: [
    'Valid government-issued ID proof (Aadhaar, PAN, Passport)',
    'Address proof (utility bill, bank statement)',
    'PAN card copy',
    'Bank account details for verification'
  ],
  [TOPICS.SIP_MANDATES]: [
    'Bank account details',
    'Cancelled cheque or bank statement',
    'Existing SIP details (if modifying)',
    'Amount and frequency preferences'
  ],
  [TOPICS.STATEMENTS_TAX]: [
    'Account number or folio number',
    'Date range for statements',
    'Tax year (if applicable)',
    'Email address for document delivery'
  ],
  [TOPICS.WITHDRAWALS_TIMELINES]: [
    'Account details',
    'Withdrawal amount',
    'Purpose of withdrawal',
    'Bank account details for transfer'
  ],
  [TOPICS.ACCOUNT_CHANGES]: [
    'Current account details',
    'Nominee details (name, relationship, date of birth)',
    'Updated address proof (if changing address)',
    'Signed nomination form'
  ]
};

export const SYSTEM_MESSAGES = {
  GREETING: (brandName) => `Welcome to ${brandName} Advisor Desk. This is an automated assistant.`,
  DISCLAIMER: 'This call is for general information only and not investment advice. For personalized recommendations, please speak to a registered advisor.',
  PII_WARNING: 'Please do not share your phone number, email address, or account numbers on this call.',
  PII_DETECTED: 'For your safety, please do not share phone numbers, email addresses, or account numbers on this call. Use the secure link with your booking code instead.',
  INVESTMENT_ADVICE_REFUSAL: "I'm not allowed to provide investment advice or recommendations. For that, please speak to a registered investment advisor. Would you like to book an advisor slot instead?",
  BOOKING_CODE_READ: (code) => `Your booking code is ${code}. I'll repeat that: ${code}.`,
  SECURE_URL: (url) => `To share your contact details safely, please visit: ${url} and enter your booking code. Do not share your phone or email on this call.`,
  TENTATIVE_HOLD: 'You have a tentative hold only. A member of the advisor team will confirm your appointment after reviewing your details. Thanks for calling.',
  BOOKING_CODE_NOT_FOUND: 'I could not find a booking with that code. The booking may have already been cancelled or is no longer available. Please check your email for the booking confirmation or contact our administrator for assistance.',
  BOOKING_CODE_FORGOTTEN: 'If you have forgotten your booking code, please check your email for the booking confirmation message. If you cannot find it, please contact our administrator for assistance. Is there anything else I can help you with?'
};

