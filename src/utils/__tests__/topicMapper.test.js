/**
 * Unit Tests for Topic Mapper
 */

import { describe, it, expect } from '@jest/globals';
import { mapToTopic, isValidTopic, getTopicDisplayName } from '../topicMapper.js';
import { TOPICS, TOPIC_LIST } from '../../config/constants.js';

describe('Topic Mapping', () => {
  it('should map KYC/Onboarding keywords', () => {
    expect(mapToTopic('I need help with KYC')).toBe(TOPICS.KYC_ONBOARDING);
    expect(mapToTopic('onboarding process')).toBe(TOPICS.KYC_ONBOARDING);
    expect(mapToTopic('verification documents')).toBe(TOPICS.KYC_ONBOARDING);
  });

  it('should map SIP/Mandates keywords', () => {
    expect(mapToTopic('I want to set up SIP')).toBe(TOPICS.SIP_MANDATES);
    expect(mapToTopic('mandate setup')).toBe(TOPICS.SIP_MANDATES);
    expect(mapToTopic('recurring investment')).toBe(TOPICS.SIP_MANDATES);
  });

  it('should map Statements/Tax Docs keywords', () => {
    expect(mapToTopic('I need my statement')).toBe(TOPICS.STATEMENTS_TAX);
    expect(mapToTopic('tax documents')).toBe(TOPICS.STATEMENTS_TAX);
    expect(mapToTopic('form 16')).toBe(TOPICS.STATEMENTS_TAX);
  });

  it('should map Withdrawals & Timelines keywords', () => {
    expect(mapToTopic('I want to withdraw')).toBe(TOPICS.WITHDRAWALS_TIMELINES);
    expect(mapToTopic('redemption timeline')).toBe(TOPICS.WITHDRAWALS_TIMELINES);
    expect(mapToTopic('when can I get my money')).toBe(TOPICS.WITHDRAWALS_TIMELINES);
  });

  it('should map Account Changes/Nominee keywords', () => {
    expect(mapToTopic('I want to change nominee')).toBe(TOPICS.ACCOUNT_CHANGES);
    expect(mapToTopic('update account details')).toBe(TOPICS.ACCOUNT_CHANGES);
    expect(mapToTopic('nomination form')).toBe(TOPICS.ACCOUNT_CHANGES);
  });

  it('should return null for unmapped topics', () => {
    expect(mapToTopic('random text')).toBe(null);
    expect(mapToTopic('hello')).toBe(null);
  });

  it('should handle empty or null input', () => {
    expect(mapToTopic('')).toBe(null);
    expect(mapToTopic(null)).toBe(null);
    expect(mapToTopic(undefined)).toBe(null);
  });
});

describe('Topic Validation', () => {
  it('should validate valid topics', () => {
    TOPIC_LIST.forEach(topic => {
      expect(isValidTopic(topic)).toBe(true);
    });
  });

  it('should reject invalid topics', () => {
    expect(isValidTopic('Invalid Topic')).toBe(false);
    expect(isValidTopic('')).toBe(false);
    expect(isValidTopic(null)).toBe(false);
    expect(isValidTopic(undefined)).toBe(false);
  });
});

describe('Topic Display Name', () => {
  it('should return topic name for valid topic', () => {
    expect(getTopicDisplayName(TOPICS.KYC_ONBOARDING)).toBe(TOPICS.KYC_ONBOARDING);
  });

  it('should return "Unknown" for invalid topic', () => {
    expect(getTopicDisplayName('Invalid')).toBe('Invalid');
    expect(getTopicDisplayName(null)).toBe('Unknown');
  });
});

