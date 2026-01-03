/**
 * Timezone Utilities
 * Provides consistent IST (Asia/Kolkata) timezone handling throughout the application
 */

import { format, parseISO } from 'date-fns';
import { utcToZonedTime, zonedTimeToUtc } from 'date-fns-tz';

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

