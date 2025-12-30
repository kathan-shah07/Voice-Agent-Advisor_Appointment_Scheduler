/**
 * Dialog State Machine
 * Manages conversation state and transitions
 */

import { INTENTS } from '../config/constants.js';

export const DIALOG_STATES = {
  INITIAL: 'initial',
  GREETING: 'greeting',
  INTENT_CONFIRMATION: 'intent_confirmation',
  TOPIC_SELECTION: 'topic_selection',
  TOPIC_CONFIRMATION: 'topic_confirmation',
  TIME_PREFERENCE: 'time_preference',
  SLOT_OFFER: 'slot_offer',
  SLOT_CONFIRMATION: 'slot_confirmation',
  BOOKING_CODE: 'booking_code',
  RESCHEDULE_CODE_INPUT: 'reschedule_code_input',
  RESCHEDULE_TIME: 'reschedule_time',
  RESCHEDULE_SLOT_CONFIRMATION: 'reschedule_slot_confirmation',
  CANCEL_CODE_INPUT: 'cancel_code_input',
  CANCEL_CONFIRMATION: 'cancel_confirmation',
  PREPARATION_INFO: 'preparation_info',
  AVAILABILITY_CHECK: 'availability_check',
  COMPLETED: 'completed',
  ERROR: 'error'
};

/**
 * Dialog State Manager
 */
export class DialogStateManager {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.state = DIALOG_STATES.INITIAL;
    this.intent = null;
    this.slots = {
      topic: null,
      preferred_day: null,
      preferred_time_window: null,
      booking_code: null,
      selected_slot: null,
      booking_code_generated: null
    };
    this.context = {
      greeting_sent: false,
      disclaimer_sent: false,
      pii_warning_sent: false
    };
    this.history = [];
  }

  /**
   * Transition to a new state
   */
  transitionTo(newState) {
    this.history.push({ from: this.state, to: newState, timestamp: new Date() });
    this.state = newState;
  }

  /**
   * Set intent
   */
  setIntent(intent) {
    this.intent = intent;
  }

  /**
   * Update slots
   */
  updateSlots(newSlots) {
    this.slots = { ...this.slots, ...newSlots };
  }

  /**
   * Get current state
   */
  getState() {
    return this.state;
  }

  /**
   * Get intent
   */
  getIntent() {
    return this.intent;
  }

  /**
   * Get slots
   */
  getSlots() {
    return this.slots;
  }

  /**
   * Add message to history
   */
  addMessage(role, content) {
    this.history.push({ role, content, timestamp: new Date() });
  }

  /**
   * Get conversation history
   */
  getHistory() {
    return this.history;
  }

  /**
   * Reset state (for new conversation)
   */
  reset() {
    this.state = DIALOG_STATES.INITIAL;
    this.intent = null;
    this.slots = {
      topic: null,
      preferred_day: null,
      preferred_time_window: null,
      booking_code: null,
      selected_slot: null,
      booking_code_generated: null
    };
    this.context = {
      greeting_sent: false,
      disclaimer_sent: false,
      pii_warning_sent: false
    };
    this.history = [];
  }

  /**
   * Check if required slots are filled for current intent
   */
  areRequiredSlotsFilled() {
    switch (this.intent) {
      case INTENTS.BOOK_NEW:
        return this.slots.topic !== null && 
               this.slots.preferred_day !== null && 
               this.slots.preferred_time_window !== null;
      case INTENTS.RESCHEDULE:
        return this.slots.booking_code !== null && 
               this.slots.preferred_day !== null && 
               this.slots.preferred_time_window !== null;
      case INTENTS.CANCEL:
        return this.slots.booking_code !== null;
      case INTENTS.WHAT_TO_PREPARE:
        return true; // Topic is optional
      case INTENTS.CHECK_AVAILABILITY:
        return true; // Day range is optional
      default:
        return false;
    }
  }
}

