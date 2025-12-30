/**
 * Unit Tests for Dialog State Manager
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { DialogStateManager, DIALOG_STATES } from '../dialogState.js';
import { INTENTS } from '../../config/constants.js';

describe('Dialog State Manager', () => {
  let stateManager;

  beforeEach(() => {
    stateManager = new DialogStateManager('test-session-123');
  });

  it('should initialize with correct default state', () => {
    expect(stateManager.getState()).toBe(DIALOG_STATES.INITIAL);
    expect(stateManager.getIntent()).toBe(null);
    expect(stateManager.getSlots()).toEqual({
      topic: null,
      preferred_day: null,
      preferred_time_window: null,
      booking_code: null,
      selected_slot: null,
      booking_code_generated: null
    });
  });

  it('should transition between states', () => {
    stateManager.transitionTo(DIALOG_STATES.GREETING);
    expect(stateManager.getState()).toBe(DIALOG_STATES.GREETING);
    
    stateManager.transitionTo(DIALOG_STATES.TOPIC_SELECTION);
    expect(stateManager.getState()).toBe(DIALOG_STATES.TOPIC_SELECTION);
  });

  it('should track state history', () => {
    stateManager.transitionTo(DIALOG_STATES.GREETING);
    stateManager.transitionTo(DIALOG_STATES.TOPIC_SELECTION);
    
    const history = stateManager.history;
    expect(history.length).toBe(2);
    expect(history[0].to).toBe(DIALOG_STATES.GREETING);
    expect(history[1].to).toBe(DIALOG_STATES.TOPIC_SELECTION);
  });

  it('should set and get intent', () => {
    stateManager.setIntent(INTENTS.BOOK_NEW);
    expect(stateManager.getIntent()).toBe(INTENTS.BOOK_NEW);
  });

  it('should update slots', () => {
    stateManager.updateSlots({ topic: 'KYC/Onboarding' });
    expect(stateManager.getSlots().topic).toBe('KYC/Onboarding');
    
    stateManager.updateSlots({ preferred_day: new Date() });
    expect(stateManager.getSlots().topic).toBe('KYC/Onboarding'); // Should preserve
    expect(stateManager.getSlots().preferred_day).not.toBe(null);
  });

  it('should add messages to history', () => {
    stateManager.addMessage('user', 'Hello');
    stateManager.addMessage('assistant', 'Hi there');
    
    const history = stateManager.getHistory();
    expect(history.length).toBe(2);
    expect(history[0].role).toBe('user');
    expect(history[1].role).toBe('assistant');
  });

  it('should check required slots for book_new intent', () => {
    stateManager.setIntent(INTENTS.BOOK_NEW);
    expect(stateManager.areRequiredSlotsFilled()).toBe(false);
    
    stateManager.updateSlots({
      topic: 'KYC/Onboarding',
      preferred_day: new Date(),
      preferred_time_window: 'morning'
    });
    expect(stateManager.areRequiredSlotsFilled()).toBe(true);
  });

  it('should check required slots for reschedule intent', () => {
    stateManager.setIntent(INTENTS.RESCHEDULE);
    expect(stateManager.areRequiredSlotsFilled()).toBe(false);
    
    stateManager.updateSlots({
      booking_code: 'NL-A742',
      preferred_day: new Date(),
      preferred_time_window: 'afternoon'
    });
    expect(stateManager.areRequiredSlotsFilled()).toBe(true);
  });

  it('should check required slots for cancel intent', () => {
    stateManager.setIntent(INTENTS.CANCEL);
    expect(stateManager.areRequiredSlotsFilled()).toBe(false);
    
    stateManager.updateSlots({ booking_code: 'NL-A742' });
    expect(stateManager.areRequiredSlotsFilled()).toBe(true);
  });

  it('should reset state', () => {
    stateManager.setIntent(INTENTS.BOOK_NEW);
    stateManager.updateSlots({ topic: 'KYC/Onboarding' });
    stateManager.transitionTo(DIALOG_STATES.TOPIC_SELECTION);
    stateManager.addMessage('user', 'test');
    
    stateManager.reset();
    
    expect(stateManager.getState()).toBe(DIALOG_STATES.INITIAL);
    expect(stateManager.getIntent()).toBe(null);
    expect(stateManager.getSlots().topic).toBe(null);
    expect(stateManager.getHistory().length).toBe(0);
  });
});

