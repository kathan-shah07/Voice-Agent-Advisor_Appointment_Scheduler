/**
 * Unit Tests for Availability Service
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { getAvailableSlots, formatSlot, parseDateTimePreference } from '../availabilityService.js';
import { TIME_WINDOWS } from '../../config/constants.js';
import { addDays, setHours, setMinutes, startOfDay } from 'date-fns';
import { utcToZonedTime, zonedTimeToUtc } from 'date-fns-tz';

const IST_TIMEZONE = 'Asia/Kolkata';

describe('Availability Service', () => {
  let baseDate;

  beforeEach(() => {
    // Use a known Monday for consistent testing
    baseDate = new Date('2025-01-13T10:00:00Z'); // Monday
  });

  it('should return available slots for a working day', () => {
    const slots = getAvailableSlots(baseDate, TIME_WINDOWS.MORNING, 30, []);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.length).toBeLessThanOrEqual(2);
  });

  it('should return slots within time window', () => {
    const slots = getAvailableSlots(baseDate, TIME_WINDOWS.MORNING, 30, []);
    slots.forEach(slot => {
      const istSlot = utcToZonedTime(slot.start, IST_TIMEZONE);
      const hour = istSlot.getHours();
      expect(hour).toBeGreaterThanOrEqual(10);
      expect(hour).toBeLessThan(12);
    });
  });

  it('should avoid conflicts with existing bookings', () => {
    const existingBookings = [
      {
        start: setHours(startOfDay(baseDate), 10),
        end: setMinutes(setHours(startOfDay(baseDate), 10), 30)
      }
    ];

    const slots = getAvailableSlots(baseDate, TIME_WINDOWS.MORNING, 30, existingBookings);
    slots.forEach(slot => {
      const hasConflict = existingBookings.some(booking => {
        return (
          (slot.start >= booking.start && slot.start < booking.end) ||
          (slot.end > booking.start && slot.end <= booking.end)
        );
      });
      expect(hasConflict).toBe(false);
    });
  });

  it('should return up to 2 slots', () => {
    const slots = getAvailableSlots(baseDate, TIME_WINDOWS.ANY, 30, []);
    expect(slots.length).toBeLessThanOrEqual(2);
  });

  it('should handle non-working days by finding next working day', () => {
    const sunday = new Date('2025-01-12T10:00:00Z'); // Sunday
    const slots = getAvailableSlots(sunday, TIME_WINDOWS.MORNING, 30, []);
    // Should return slots for Monday instead
    expect(slots.length).toBeGreaterThan(0);
  });
});

describe('Slot Formatting', () => {
  it('should format slot with IST timezone', () => {
    const start = new Date('2025-01-14T10:00:00Z');
    const end = new Date('2025-01-14T10:30:00Z');
    const formatted = formatSlot(start, end);
    
    expect(formatted).toContain('IST');
    expect(formatted).toContain('January');
  });

  it('should include day name and date', () => {
    const start = new Date('2025-01-14T10:00:00Z');
    const end = new Date('2025-01-14T10:30:00Z');
    const formatted = formatSlot(start, end);
    
    expect(formatted).toContain('Tuesday'); // Jan 14, 2025 is a Tuesday
    expect(formatted).toContain('January');
  });
});

describe('Date/Time Preference Parsing', () => {
  it('should parse "today"', () => {
    const result = parseDateTimePreference('today');
    expect(result.date).not.toBe(null);
    expect(result.timeWindow).toBe(TIME_WINDOWS.ANY);
  });

  it('should parse "tomorrow"', () => {
    const result = parseDateTimePreference('tomorrow');
    expect(result.date).not.toBe(null);
  });

  it('should parse day names', () => {
    const result = parseDateTimePreference('Monday');
    expect(result.date).not.toBe(null);
  });

  it('should parse time windows', () => {
    const result1 = parseDateTimePreference('tomorrow morning');
    expect(result1.timeWindow).toBe(TIME_WINDOWS.MORNING);

    const result2 = parseDateTimePreference('afternoon');
    expect(result2.timeWindow).toBe(TIME_WINDOWS.AFTERNOON);

    const result3 = parseDateTimePreference('evening');
    expect(result3.timeWindow).toBe(TIME_WINDOWS.EVENING);
  });

  it('should handle empty or invalid input', () => {
    const result = parseDateTimePreference('');
    expect(result.date).toBe(null);
    expect(result.timeWindow).toBe(null);
  });
});

