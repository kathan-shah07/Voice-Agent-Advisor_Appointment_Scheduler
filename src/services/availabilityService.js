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
import { IST_TIMEZONE } from '../utils/timezone.js';

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
  
  // Check if it's a working day (Monday = 1, Friday = 5)
  // Skip weekends: Saturday = 6, Sunday = 0
  if (!WORKING_DAYS_LIST.includes(dayOfWeek)) {
    // If not a working day, find next working day
    // If Saturday (6), skip to Monday (add 2 days)
    // If Sunday (0), skip to Monday (add 1 day)
    const daysToAdd = dayOfWeek === 6 ? 2 : 1; // Saturday -> Monday, Sunday -> Monday
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
        const bookingStart = new Date(booking.start);
        const bookingEnd = new Date(booking.end);
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
    const bookingStart = new Date(booking.start);
    const bookingEnd = new Date(booking.end);
    
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
  } else if (normalized.includes('tomorrow')) {
    targetDate = addDays(istToday, 1);
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
    if (normalized.includes('morning') || normalized.includes('am') && (normalized.includes('10') || normalized.includes('11'))) {
      timeWindow = TIME_WINDOWS.MORNING;
    } else if (normalized.includes('afternoon') || (normalized.includes('pm') && !normalized.includes('evening') && !normalized.includes('morning'))) {
      timeWindow = TIME_WINDOWS.AFTERNOON;
    } else if (normalized.includes('evening') || (normalized.includes('pm') && (normalized.includes('4') || normalized.includes('5') || normalized.includes('6')))) {
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

