/**
 * Mock Availability Service
 * Returns available time slots based on working hours and preferences
 */

import { 
  TIME_WINDOWS, 
  TIME_WINDOW_RANGES, 
  WORKING_DAYS, 
  WORKING_DAYS_LIST,
  SLOT_DURATION_MINUTES,
  WORKING_HOURS 
} from '../config/constants.js';
import { addDays, setHours, setMinutes, format, isAfter, startOfDay, getDay } from 'date-fns';
import { zonedTimeToUtc, utcToZonedTime } from 'date-fns-tz';

const IST_TIMEZONE = 'Asia/Kolkata';

/**
 * Generate mock available slots
 * @param {Date} preferredDate - Preferred date
 * @param {string} timeWindow - Time window (morning, afternoon, evening, any)
 * @param {number} slotMinutes - Slot duration in minutes (default: 30)
 * @param {Array} existingBookings - Array of existing bookings to avoid conflicts
 * @returns {Array<Object>} Array of available slots [{ start, end }]
 */
export function getAvailableSlots(preferredDate, timeWindow = TIME_WINDOWS.ANY, slotMinutes = SLOT_DURATION_MINUTES, existingBookings = []) {
  // Convert to IST
  const istDate = utcToZonedTime(preferredDate, IST_TIMEZONE);
  const dayOfWeek = getDay(istDate);
  
  // Check if it's a working day (Monday = 1, Saturday = 6)
  if (!WORKING_DAYS_LIST.includes(dayOfWeek)) {
    // If not a working day, find next working day
    return getAvailableSlots(
      addDays(preferredDate, 1),
      timeWindow,
      slotMinutes,
      existingBookings
    );
  }
  
  // Get time window range
  const windowRange = TIME_WINDOW_RANGES[timeWindow] || TIME_WINDOW_RANGES[TIME_WINDOWS.ANY];
  
  // Generate slots within the time window
  const slots = [];
  const startHour = Math.max(windowRange.start, WORKING_HOURS.start);
  const endHour = Math.min(windowRange.end, WORKING_HOURS.end);
  
  // Generate slots every 30 minutes
  for (let hour = startHour; hour < endHour; hour++) {
    for (let minute = 0; minute < 60; minute += slotMinutes) {
      if (hour === endHour - 1 && minute >= 60 - slotMinutes) {
        break; // Don't create slots that extend beyond working hours
      }
      
      const slotStart = setMinutes(setHours(startOfDay(istDate), hour), minute);
      const slotEnd = setMinutes(setHours(startOfDay(istDate), hour), minute + slotMinutes);
      
      // Check if slot conflicts with existing bookings
      const hasConflict = existingBookings.some(booking => {
        const bookingStart = new Date(booking.start);
        const bookingEnd = new Date(booking.end);
        return (
          (slotStart >= bookingStart && slotStart < bookingEnd) ||
          (slotEnd > bookingStart && slotEnd <= bookingEnd) ||
          (slotStart <= bookingStart && slotEnd >= bookingEnd)
        );
      });
      
      if (!hasConflict) {
        slots.push({
          start: slotStart,
          end: slotEnd
        });
      }
    }
  }
  
  // Return up to 2 slots
  return slots.slice(0, 2);
}

/**
 * Format slot for display
 * @param {Date} start - Slot start time
 * @param {Date} end - Slot end time
 * @returns {string} Formatted slot string
 */
export function formatSlot(start, end) {
  const istStart = utcToZonedTime(start, IST_TIMEZONE);
  const istEnd = utcToZonedTime(end, IST_TIMEZONE);
  
  const dayName = format(istStart, 'EEEE');
  const date = format(istStart, 'd MMMM');
  const startTime = format(istStart, 'h:mm a');
  const endTime = format(istEnd, 'h:mm a');
  
  return `${dayName}, ${date} from ${startTime} to ${endTime} IST`;
}

/**
 * Parse date/time preference from user input
 * @param {string} userInput - User's date/time preference (e.g., "tomorrow afternoon", "Monday after 4 PM")
 * @returns {Object} { date: Date, timeWindow: string }
 */
export function parseDateTimePreference(userInput) {
  if (!userInput || typeof userInput !== 'string') {
    return { date: null, timeWindow: null };
  }
  
  const normalized = userInput.toLowerCase().trim();
  const today = new Date();
  const istToday = utcToZonedTime(today, IST_TIMEZONE);
  
  let targetDate = istToday;
  let timeWindow = TIME_WINDOWS.ANY;
  
  // Parse date references
  if (normalized.includes('today')) {
    targetDate = istToday;
  } else if (normalized.includes('tomorrow')) {
    targetDate = addDays(istToday, 1);
  } else if (normalized.includes('monday')) {
    const daysUntilMonday = (1 - getDay(istToday) + 7) % 7 || 7;
    targetDate = addDays(istToday, daysUntilMonday);
  } else if (normalized.includes('tuesday')) {
    const daysUntilTuesday = (2 - getDay(istToday) + 7) % 7 || 7;
    targetDate = addDays(istToday, daysUntilTuesday);
  } else if (normalized.includes('wednesday')) {
    const daysUntilWednesday = (3 - getDay(istToday) + 7) % 7 || 7;
    targetDate = addDays(istToday, daysUntilWednesday);
  } else if (normalized.includes('thursday')) {
    const daysUntilThursday = (4 - getDay(istToday) + 7) % 7 || 7;
    targetDate = addDays(istToday, daysUntilThursday);
  } else if (normalized.includes('friday')) {
    const daysUntilFriday = (5 - getDay(istToday) + 7) % 7 || 7;
    targetDate = addDays(istToday, daysUntilFriday);
  } else if (normalized.includes('saturday')) {
    const daysUntilSaturday = (6 - getDay(istToday) + 7) % 7 || 7;
    targetDate = addDays(istToday, daysUntilSaturday);
  }
  
  // Parse time windows
  if (normalized.includes('morning') || normalized.includes('am') && normalized.includes('10') || normalized.includes('11')) {
    timeWindow = TIME_WINDOWS.MORNING;
  } else if (normalized.includes('afternoon') || (normalized.includes('pm') && !normalized.includes('evening'))) {
    timeWindow = TIME_WINDOWS.AFTERNOON;
  } else if (normalized.includes('evening') || (normalized.includes('pm') && (normalized.includes('4') || normalized.includes('5') || normalized.includes('6')))) {
    timeWindow = TIME_WINDOWS.EVENING;
  }
  
  // Convert back to UTC for consistency
  const utcDate = zonedTimeToUtc(targetDate, IST_TIMEZONE);
  
  return { date: utcDate, timeWindow };
}

