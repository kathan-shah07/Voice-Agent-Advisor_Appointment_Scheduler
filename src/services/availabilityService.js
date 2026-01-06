/**
 * Availability Service
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
import { IST_TIMEZONE, parseIST12HourWithSeconds, parseIST12Hour } from '../utils/timezone.js';

/**
 * Generate available slots
 * @param {Date} preferredDate - Preferred date
 * @param {string} timeWindow - Time window (morning, afternoon, evening, any)
 * @param {number} slotMinutes - Slot duration in minutes (default: 30)
 * @param {Array} existingBookings - Array of existing bookings to avoid conflicts
 * @returns {Promise<Array<Object>>} Array of available slots [{ start, end }]
 */
export async function getAvailableSlots(preferredDate, timeWindow = TIME_WINDOWS.ANY, slotMinutes = SLOT_DURATION_MINUTES, existingBookings = []) {
  return getMockAvailableSlots(preferredDate, timeWindow, slotMinutes, existingBookings);
}

/**
 * Generate mock available slots (fallback)
 * @private
 */
function getMockAvailableSlots(preferredDate, timeWindow = TIME_WINDOWS.ANY, slotMinutes = SLOT_DURATION_MINUTES, existingBookings = []) {
  // Convert to IST
  const istDate = utcToZonedTime(preferredDate, IST_TIMEZONE);
  let dayOfWeek = getDay(istDate);

  // Check if it's a working day (Monday = 1, Saturday = 6)
  if (!WORKING_DAYS_LIST.includes(dayOfWeek)) {
    // If not a working day (Sunday = 0), skip to Monday
    const daysToAdd = 1;
    return getAvailableSlots(
      addDays(preferredDate, daysToAdd),
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

  // Always return exactly 2 slots if available, otherwise return what we have
  // If we have fewer than 2 slots, try to generate more by expanding the time window slightly
  if (slots.length < 2 && slots.length > 0) {
    // Try to find one more slot by expanding search slightly
    const lastSlot = slots[slots.length - 1];
    const lastSlotEnd = lastSlot.end;
    const expandedEnd = new Date(lastSlotEnd.getTime() + slotMinutes * 60000);

    // Check if expanded slot is still within working hours
    const expandedEndIST = utcToZonedTime(expandedEnd, IST_TIMEZONE);
    if (expandedEndIST.getHours() < WORKING_HOURS.end ||
      (expandedEndIST.getHours() === WORKING_HOURS.end && expandedEndIST.getMinutes() === 0)) {
      const expandedSlot = {
        start: expandedEnd,
        end: new Date(expandedEnd.getTime() + slotMinutes * 60000)
      };

      // Check for conflicts
      const hasConflict = existingBookings.some(booking => {
        const bookingStart = new Date(booking.slot || booking.start);
        const bookingEnd = new Date(booking.endSlot || booking.end);
        return (
          (expandedSlot.start >= bookingStart && expandedSlot.start < bookingEnd) ||
          (expandedSlot.end > bookingStart && expandedSlot.end <= bookingEnd) ||
          (expandedSlot.start <= bookingStart && expandedSlot.end >= bookingEnd)
        );
      });

      if (!hasConflict) {
        slots.push(expandedSlot);
      }
    }
  }

  // Return up to 2 slots
  return slots.slice(0, 2);
}

/**
 * Check if a preferred slot overlaps with existing bookings
 * @param {Date} preferredStart - Preferred slot start time (UTC)
 * @param {Date} preferredEnd - Preferred slot end time (UTC)
 * @param {Array} existingBookings - Array of existing bookings [{ start, end }]
 * @returns {Object} { hasOverlap: boolean, overlappingSlots: Array }
 */
export function checkSlotOverlap(preferredStart, preferredEnd, existingBookings = []) {
  const overlappingSlots = existingBookings.filter(booking => {
    const bookingStart = new Date(booking.slot || booking.start);
    const bookingEnd = new Date(booking.endSlot || booking.end);

    // Check for any overlap
    return (
      (preferredStart >= bookingStart && preferredStart < bookingEnd) ||
      (preferredEnd > bookingStart && preferredEnd <= bookingEnd) ||
      (preferredStart <= bookingStart && preferredEnd >= bookingEnd)
    );
  });

  return {
    hasOverlap: overlappingSlots.length > 0,
    overlappingSlots: overlappingSlots.map(slot => ({
      start: slot.start,
      end: slot.end
    }))
  };
}

/**
 * Format slot for display
 * Handles both Date objects and IST 12-hour format strings
 * @param {Date|string} start - Slot start time (Date or IST 12-hour format string)
 * @param {Date|string} end - Slot end time (Date or IST 12-hour format string)
 * @returns {string} Formatted slot string
 */
export function formatSlot(start, end) {
  // Convert to Date objects if needed (handles IST 12-hour format strings)
  let startDate = start;
  let endDate = end;
  
  // Helper function to safely parse date
  const safeParseDate = (dateValue) => {
    if (!dateValue) return null;
    
    // If already a Date object, validate it
    if (dateValue instanceof Date) {
      return isNaN(dateValue.getTime()) ? null : dateValue;
    }
    
    // If string, try parsing
    if (typeof dateValue === 'string') {
      // Check if in IST 12-hour format (contains AM/PM)
      if (dateValue.includes(' AM') || dateValue.includes(' PM')) {
        const parsed = parseIST12HourWithSeconds(dateValue);
        if (parsed && !isNaN(parsed.getTime())) {
          return parsed;
        }
        // Fallback to format without seconds
        const parsedNoSeconds = parseIST12Hour(dateValue);
        if (parsedNoSeconds && !isNaN(parsedNoSeconds.getTime())) {
          return parsedNoSeconds;
        }
      }
      
      // Try parsing as ISO string
      try {
        const isoDate = new Date(dateValue);
        if (!isNaN(isoDate.getTime())) {
          return isoDate;
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
    
    return null;
  };
  
  // Parse start date
  if (typeof start !== 'object' || !(start instanceof Date)) {
    startDate = safeParseDate(start);
    if (!startDate) {
      throw new Error(`Invalid start date format: ${start}`);
    }
  } else {
    if (isNaN(start.getTime())) {
      throw new Error(`Invalid start date: ${start}`);
    }
  }
  
  // Parse end date
  if (typeof end !== 'object' || !(end instanceof Date)) {
    endDate = safeParseDate(end);
    if (!endDate) {
      throw new Error(`Invalid end date format: ${end}`);
    }
  } else {
    if (isNaN(end.getTime())) {
      throw new Error(`Invalid end date: ${end}`);
    }
  }
  
  const istStart = utcToZonedTime(startDate, IST_TIMEZONE);
  const istEnd = utcToZonedTime(endDate, IST_TIMEZONE);

  const dayName = format(istStart, 'EEEE');
  const date = format(istStart, 'd MMMM');
  const startTime = format(istStart, 'h:mm a');
  const endTime = format(istEnd, 'h:mm a');

  return `${dayName}, ${date} from ${startTime} to ${endTime} IST`;
}

/**
 * Parse date/time preference from user input with enhanced natural language support
 * @param {string} userInput - User's date/time preference (e.g., "tomorrow afternoon", "Monday after 4 PM", "next week", "3 PM")
 * @returns {Object} { date: Date, timeWindow: string, specificTime: Date|null, isWeekend: boolean, requestedWeekend: boolean }
 */
export function parseDateTimePreference(userInput) {
  if (!userInput || typeof userInput !== 'string') {
    return { date: null, timeWindow: null, specificTime: null, isWeekend: false, requestedWeekend: false };
  }

  const normalized = userInput.toLowerCase().trim();
  const today = new Date();
  const istToday = utcToZonedTime(today, IST_TIMEZONE);

  let targetDate = istToday;
  let timeWindow = TIME_WINDOWS.ANY;
  let specificTime = null;
  let requestedWeekend = false; // Track if user explicitly requested weekend

  // Parse "next week", "next Monday", etc.
  const nextWeekMatch = normalized.match(/next\s+(week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
  if (nextWeekMatch) {
    if (nextWeekMatch[1] === 'week') {
      // For "next week", find the next Monday
      const currentDay = getDay(istToday);
      const daysUntilMonday = (1 - currentDay + 7) % 7 || 7;
      targetDate = addDays(istToday, daysUntilMonday);
    } else {
      const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const targetDay = dayNames.indexOf(nextWeekMatch[1]);
      // Mark weekend requests
      if (targetDay === 0 || targetDay === 6) {
        requestedWeekend = true;
        const currentDay = getDay(istToday);
        const daysUntilWeekend = (targetDay - currentDay + 7) % 7 || 7;
        targetDate = addDays(istToday, daysUntilWeekend);
      } else {
        const currentDay = getDay(istToday);
        const daysUntil = (targetDay - currentDay + 7) % 7 || 7;
        targetDate = addDays(istToday, daysUntil);
      }
    }
  }
  // Parse date references
  else if (normalized.includes('today')) {
    targetDate = istToday;
  } else if (normalized.includes('tomorrow') || normalized.includes('next day')) {
    targetDate = addDays(istToday, 1);
  } else if (normalized.includes('day after tomorrow')) {
    targetDate = addDays(istToday, 2);
  } else if (normalized.includes('monday') || normalized.includes('mon')) {
    const daysUntilMonday = (1 - getDay(istToday) + 7) % 7 || 7;
    targetDate = addDays(istToday, daysUntilMonday);
  } else if (normalized.includes('tuesday') || normalized.includes('tue')) {
    const daysUntilTuesday = (2 - getDay(istToday) + 7) % 7 || 7;
    targetDate = addDays(istToday, daysUntilTuesday);
  } else if (normalized.includes('wednesday') || normalized.includes('wed')) {
    const daysUntilWednesday = (3 - getDay(istToday) + 7) % 7 || 7;
    targetDate = addDays(istToday, daysUntilWednesday);
  } else if (normalized.includes('thursday') || normalized.includes('thu')) {
    const daysUntilThursday = (4 - getDay(istToday) + 7) % 7 || 7;
    targetDate = addDays(istToday, daysUntilThursday);
  } else if (normalized.includes('friday') || normalized.includes('fri')) {
    const daysUntilFriday = (5 - getDay(istToday) + 7) % 7 || 7;
    targetDate = addDays(istToday, daysUntilFriday);
  } else if (normalized.includes('saturday') || normalized.includes('sat')) {
    // User explicitly requested Saturday - mark as weekend request
    requestedWeekend = true;
    const daysUntilSaturday = (6 - getDay(istToday) + 7) % 7 || 7;
    targetDate = addDays(istToday, daysUntilSaturday);
  } else if (normalized.includes('sunday') || normalized.includes('sun')) {
    // User explicitly requested Sunday - mark as weekend request
    requestedWeekend = true;
    const daysUntilSunday = (0 - getDay(istToday) + 7) % 7 || 7;
    targetDate = addDays(istToday, daysUntilSunday);
  }

  // Parse specific times (e.g., "3 PM", "10:30 AM", "after 4 PM", "before noon")
  const timePatterns = [
    /(\d{1,2}):(\d{2})\s*(am|pm)/i,  // "3:30 PM", "10:15 AM"
    /(\d{1,2})\s*(am|pm)/i,          // "3 PM", "10 AM"
    /after\s+(\d{1,2})\s*(am|pm)?/i, // "after 4 PM", "after 3"
    /before\s+(\d{1,2})\s*(am|pm)?/i, // "before noon", "before 5"
    /(\d{1,2})\s*o'?clock/i,         // "3 o'clock"
    /noon|midday/i,                   // "noon", "midday"
  ];

  let parsedHour = null;
  let parsedMinute = 0;
  let isPM = false;

  for (const pattern of timePatterns) {
    const match = normalized.match(pattern);
    if (match) {
      if (match[0].includes('noon') || match[0].includes('midday')) {
        parsedHour = 12;
        isPM = false;
        break;
      } else if (match[1]) {
        parsedHour = parseInt(match[1], 10);
        parsedMinute = match[2] ? parseInt(match[2], 10) : 0;
        isPM = match[3] ? match[3].toLowerCase() === 'pm' : (parsedHour < 12 && normalized.includes('pm'));

        // Handle 12-hour format
        if (parsedHour === 12 && !isPM) {
          parsedHour = 0; // 12 AM = midnight
        } else if (parsedHour !== 12 && isPM) {
          parsedHour += 12; // Convert to 24-hour
        }
        break;
      }
    }
  }

  // If specific time found, create specific time object
  if (parsedHour !== null) {
    specificTime = setMinutes(setHours(startOfDay(targetDate), parsedHour), parsedMinute);
    // Determine time window from specific hour
    if (parsedHour >= 10 && parsedHour < 12) {
      timeWindow = TIME_WINDOWS.MORNING;
    } else if (parsedHour >= 12 && parsedHour < 16) {
      timeWindow = TIME_WINDOWS.AFTERNOON;
    } else if (parsedHour >= 16 && parsedHour < 18) {
      timeWindow = TIME_WINDOWS.EVENING;
    }
  }
  // Parse time windows (only if no specific time found)
  else {
    if (normalized.includes('morning') || normalized.includes('early morning') || normalized.includes('am')) {
      timeWindow = TIME_WINDOWS.MORNING;
    } else if (normalized.includes('afternoon') || normalized.includes('noon') || normalized.includes('midday') || (normalized.includes('pm') && !normalized.includes('evening') && !normalized.includes('night'))) {
      timeWindow = TIME_WINDOWS.AFTERNOON;
    } else if (normalized.includes('evening') || normalized.includes('night') || normalized.includes('late') || (normalized.includes('pm') && (normalized.includes('4') || normalized.includes('5') || normalized.includes('6')))) {
      timeWindow = TIME_WINDOWS.EVENING;
    }
  }

  // Handle "after" and "before" modifiers for time windows
  if (normalized.includes('after') && !parsedHour) {
    if (normalized.includes('afternoon') || normalized.match(/after\s+(\d+)\s*pm/i)) {
      timeWindow = TIME_WINDOWS.AFTERNOON;
    } else if (normalized.includes('evening') || normalized.match(/after\s+(\d+)\s*pm/i)) {
      timeWindow = TIME_WINDOWS.EVENING;
    }
  }

  if (normalized.includes('before') && !parsedHour) {
    if (normalized.includes('noon') || normalized.includes('midday')) {
      timeWindow = TIME_WINDOWS.MORNING;
    } else if (normalized.match(/before\s+(\d+)\s*pm/i)) {
      const hourMatch = normalized.match(/before\s+(\d+)/i);
      if (hourMatch) {
        const hour = parseInt(hourMatch[1], 10);
        if (hour <= 12) {
          timeWindow = TIME_WINDOWS.MORNING;
        } else if (hour <= 16) {
          timeWindow = TIME_WINDOWS.AFTERNOON;
        }
      }
    }
  }

  // Check if the target date falls on a weekend
  const targetDayOfWeek = getDay(targetDate);
  const isWeekend = targetDayOfWeek === 0 || targetDayOfWeek === 6; // Sunday = 0, Saturday = 6

  // Convert back to UTC for consistency
  const utcDate = zonedTimeToUtc(targetDate, IST_TIMEZONE);
  const utcSpecificTime = specificTime ? zonedTimeToUtc(specificTime, IST_TIMEZONE) : null;

  return {
    date: utcDate,
    timeWindow,
    specificTime: utcSpecificTime,
    isWeekend: isWeekend,
    requestedWeekend: requestedWeekend
  };
}

/**
 * Validate if a requested time slot is within business hours
 * @param {Date} slotStart - Start time of the slot
 * @param {Date} slotEnd - End time of the slot
 * @returns {Object} { isValid: boolean, reason: string }
 */
export function isWithinBusinessHours(slotStart, slotEnd) {
  // Convert to IST for validation
  // utcToZonedTime returns a Date where the UTC parts match the wall time in the target zone
  const istStart = utcToZonedTime(slotStart, IST_TIMEZONE);
  const istEnd = utcToZonedTime(slotEnd, IST_TIMEZONE);

  // Use UTC getters because the date is strictly shifted to match wall time in UTC components
  const dayOfWeek = istStart.getUTCDay();
  const startHour = istStart.getUTCHours();
  const startMinute = istStart.getUTCMinutes();
  const endHour = istEnd.getUTCHours();
  const endMinute = istEnd.getUTCMinutes();

  // Check if it's a working day (Monday=1 to Saturday=6, exclude Sunday=0)
  if (!WORKING_DAYS_LIST.includes(dayOfWeek)) {
    return {
      isValid: false,
      reason: 'Sunday is not a working day. Advisor slots are available Monday through Saturday.'
    };
  }

  // Check if start time is within working hours (10 AM - 6 PM)
  const startTimeInMinutes = startHour * 60 + startMinute;
  const workingStartInMinutes = WORKING_HOURS.start * 60; // 10:00 AM = 600 minutes
  const workingEndInMinutes = WORKING_HOURS.end * 60; // 6:00 PM = 1080 minutes

  if (startTimeInMinutes < workingStartInMinutes) {
    return {
      isValid: false,
      reason: `The requested time is before business hours. Advisor slots are available from ${WORKING_HOURS.start}:00 AM to ${WORKING_HOURS.end === 18 ? '6:00' : WORKING_HOURS.end + ':00'} PM IST.`
    };
  }

  // Check if end time is within working hours
  const endTimeInMinutes = endHour * 60 + endMinute;
  if (endTimeInMinutes > workingEndInMinutes) {
    return {
      isValid: false,
      reason: `The requested time extends beyond business hours. Advisor slots are available from ${WORKING_HOURS.start}:00 AM to ${WORKING_HOURS.end === 18 ? '6:00' : WORKING_HOURS.end + ':00'} PM IST.`
    };
  }

  return {
    isValid: true,
    reason: ''
  };
}
