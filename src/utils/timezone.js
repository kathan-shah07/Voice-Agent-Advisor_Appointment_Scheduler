/**
 * Timezone Utilities
 * Provides consistent IST (Asia/Kolkata) timezone handling throughout the application
 */

import { format, parseISO } from 'date-fns';
import { utcToZonedTime, zonedTimeToUtc } from 'date-fns-tz';
import { logger } from './logger.js';

export const IST_TIMEZONE = 'Asia/Kolkata';

/**
 * Convert a Date or ISO string to IST zoned time
 * @param {Date|string} date - Date object or ISO string
 * @returns {Date} Date object representing the time in IST
 */
export function toIST(date) {
  const dateObj = typeof date === 'string' ? parseISO(date) : date;
  return utcToZonedTime(dateObj, IST_TIMEZONE);
}

/**
 * Convert IST time to UTC Date
 * @param {Date|string} istDate - Date in IST timezone
 * @returns {Date} UTC Date object
 */
export function fromIST(istDate) {
  const dateObj = typeof istDate === 'string' ? parseISO(istDate) : istDate;
  return zonedTimeToUtc(dateObj, IST_TIMEZONE);
}

/**
 * Format date/time in IST using 24-hour format for storage
 * Format: YYYY-MM-DD HH:mm:ss (e.g., "2025-01-15 14:30:00")
 * @param {Date|string} date - Date object or ISO string
 * @returns {string} Formatted date/time string in IST 24-hour format
 */
export function formatIST24Hour(date) {
  const istDate = toIST(date);
  return format(istDate, 'yyyy-MM-dd HH:mm:ss');
}

/**
 * Format date in IST (date only)
 * Format: YYYY-MM-DD
 * @param {Date|string} date - Date object or ISO string
 * @returns {string} Formatted date string
 */
export function formatISTDate(date) {
  const istDate = toIST(date);
  return format(istDate, 'yyyy-MM-dd');
}

/**
 * Format time in IST using 24-hour format
 * Format: HH:mm (e.g., "14:30")
 * @param {Date|string} date - Date object or ISO string
 * @returns {string} Formatted time string in 24-hour format
 */
export function formatISTTime24Hour(date) {
  const istDate = toIST(date);
  return format(istDate, 'HH:mm');
}

/**
 * Format date/time in IST for display (with AM/PM)
 * Format: "EEEE, d MMMM yyyy 'at' h:mm a"
 * @param {Date|string} date - Date object or ISO string
 * @returns {string} Formatted date/time string for display
 */
export function formatISTDisplay(date) {
  const istDate = toIST(date);
  return format(istDate, "EEEE, d MMMM yyyy 'at' h:mm a");
}

/**
 * Create an IST date-time string from date and time components
 * @param {string} dateStr - Date string in YYYY-MM-DD format
 * @param {string} timeStr - Time string in HH:mm format (24-hour)
 * @returns {string} ISO string in UTC that represents the IST time
 */
export function createISTDateTime(dateStr, timeStr) {
  // Parse date and time as IST
  const istDateTimeStr = `${dateStr}T${timeStr}:00`;
  const istDate = parseISO(istDateTimeStr);
  
  // Convert to UTC for storage/API calls
  const utcDate = zonedTimeToUtc(istDate, IST_TIMEZONE);
  return utcDate.toISOString();
}

/**
 * Get current time in IST
 * @returns {Date} Current time as IST zoned date
 */
export function getCurrentIST() {
  return toIST(new Date());
}

/**
 * Format slot times for Google Sheets storage
 * Returns both start and end times in IST 24-hour format
 * @param {Date|string} start - Slot start time
 * @param {Date|string} end - Slot end time
 * @returns {Object} { start: string, end: string } in IST 24-hour format
 */
export function formatSlotTimesForStorage(start, end) {
  return {
    start: formatIST24Hour(start),
    end: formatIST24Hour(end)
  };
}

/**
 * Format date/time in IST using 12-hour format for storage
 * Format: "YYYY-MM-DD h:mm a" (e.g., "2025-01-15 2:30 PM")
 * @param {Date|string} date - Date object or ISO string
 * @returns {string} Formatted date/time string in IST 12-hour format
 */
export function formatIST12Hour(date) {
  const istDate = toIST(date);
  const dateStr = format(istDate, 'yyyy-MM-dd');
  const timeStr = format(istDate, 'h:mm a');
  return `${dateStr} ${timeStr}`;
}

/**
 * Parse IST 12-hour format string back to UTC Date
 * Format: "YYYY-MM-DD h:mm a" (e.g., "2025-01-15 2:30 PM")
 * @param {string} ist12HourStr - Date/time string in IST 12-hour format
 * @returns {Date} UTC Date object
 */
export function parseIST12Hour(ist12HourStr) {
  if (!ist12HourStr) return null;
  
  // Parse format: "YYYY-MM-DD h:mm a" or "YYYY-MM-DD hh:mm a"
  const match = ist12HourStr.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}):(\d{2})\s+(AM|PM)$/i);
  if (!match) {
    // Try to parse as ISO and convert
    try {
      const date = parseISO(ist12HourStr);
      return zonedTimeToUtc(date, IST_TIMEZONE);
    } catch (e) {
      logger.log('error', `Failed to parse IST 12-hour format: ${ist12HourStr}`, { error: e.message });
      return null;
    }
  }
  
  const [, dateStr, hourStr, minuteStr, ampm] = match;
  let hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);
  
  // Convert 12-hour to 24-hour
  if (ampm.toUpperCase() === 'PM' && hour !== 12) {
    hour += 12;
  } else if (ampm.toUpperCase() === 'AM' && hour === 12) {
    hour = 0;
  }
  
  // Create IST date string
  const istDateTimeStr = `${dateStr}T${hour.toString().padStart(2, '0')}:${minuteStr}:00`;
  const istDate = parseISO(istDateTimeStr);
  
  // Convert to UTC
  return zonedTimeToUtc(istDate, IST_TIMEZONE);
}

/**
 * Format date/time in IST 12-hour format for storage (with seconds)
 * Format: "YYYY-MM-DD h:mm:ss a" (e.g., "2025-01-15 2:30:45 PM")
 * @param {Date|string} date - Date object or ISO string
 * @returns {string} Formatted date/time string in IST 12-hour format with seconds
 */
export function formatIST12HourWithSeconds(date) {
  const istDate = toIST(date);
  const dateStr = format(istDate, 'yyyy-MM-dd');
  const timeStr = format(istDate, 'h:mm:ss a');
  return `${dateStr} ${timeStr}`;
}

/**
 * Parse IST 12-hour format string with seconds back to UTC Date
 * Format: "YYYY-MM-DD h:mm:ss a" (e.g., "2025-01-15 2:30:45 PM")
 * @param {string} ist12HourStr - Date/time string in IST 12-hour format with seconds
 * @returns {Date} UTC Date object
 */
export function parseIST12HourWithSeconds(ist12HourStr) {
  if (!ist12HourStr) return null;
  
  // Parse format: "YYYY-MM-DD h:mm:ss a"
  const match = ist12HourStr.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}):(\d{2}):(\d{2})\s+(AM|PM)$/i);
  if (!match) {
    // Fallback to format without seconds
    return parseIST12Hour(ist12HourStr);
  }
  
  const [, dateStr, hourStr, minuteStr, secondStr, ampm] = match;
  let hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);
  const second = parseInt(secondStr, 10);
  
  // Convert 12-hour to 24-hour
  if (ampm.toUpperCase() === 'PM' && hour !== 12) {
    hour += 12;
  } else if (ampm.toUpperCase() === 'AM' && hour === 12) {
    hour = 0;
  }
  
  // Create IST date string
  const istDateTimeStr = `${dateStr}T${hour.toString().padStart(2, '0')}:${minuteStr}:${secondStr}`;
  const istDate = parseISO(istDateTimeStr);
  
  // Convert to UTC
  return zonedTimeToUtc(istDate, IST_TIMEZONE);
}

