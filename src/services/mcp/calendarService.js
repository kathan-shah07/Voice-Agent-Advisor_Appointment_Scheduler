/**
 * Calendar MCP Service - Google Calendar integration
 * Provides calendar operations for appointment scheduling
 */

import { google } from 'googleapis';
import { MCPClient } from './mcpClient.js';
import { logger } from '../../utils/logger.js';
import dotenv from 'dotenv';
import { formatInTimeZone, toZonedTime } from 'date-fns-tz';
import { addMinutes } from 'date-fns';

dotenv.config();

const IST_TIMEZONE = 'Asia/Kolkata';

export class CalendarService extends MCPClient {
  constructor() {
    super('Google Calendar');
    this.calendar = null;
    this.calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
  }

  async _doInitialize() {
    const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || './credentials/service-account-key.json';
    
    try {
      const auth = new google.auth.GoogleAuth({
        keyFile: keyPath,
        scopes: ['https://www.googleapis.com/auth/calendar']
      });

      this.calendar = google.calendar({ version: 'v3', auth });
      
      // Test connection by listing calendars
      const response = await this.calendar.calendarList.list();
      logger.log('mcp', `Calendar service connected. Found ${response.data.items?.length || 0} calendars`, {});
      
      return true;
    } catch (error) {
      logger.log('error', `Failed to initialize calendar service: ${error.message}`, {});
      throw error;
    }
  }

  /**
   * Create a tentative hold/event
   * @param {Object} params - Event parameters
   * @param {string} params.summary - Event title
   * @param {string} params.description - Event description
   * @param {string} params.startDateTime - ISO 8601 datetime string in IST
   * @param {string} params.endDateTime - ISO 8601 datetime string in IST
   * @param {string} params.bookingCode - Booking code
   * @param {boolean} params.isWaitlist - Whether this is a waitlist entry
   * @returns {Promise<Object>} Created event
   */
  async createTentativeHold(params) {
    const { summary, description, startDateTime, endDateTime, bookingCode, isWaitlist } = params;

    if (!this.isAvailable()) {
      logger.log('mcp', 'Calendar: Mock createTentativeHold', { params });
      return {
        id: `mock-${Date.now()}`,
        summary,
        start: { dateTime: startDateTime },
        end: { dateTime: endDateTime },
        status: 'tentative'
      };
    }

    try {
      const event = {
        summary,
        description: description || `Tentative hold created via voice agent. Booking code: ${bookingCode}.${isWaitlist ? ' Status: Waitlist.' : ''}`,
        start: {
          dateTime: startDateTime,
          timeZone: IST_TIMEZONE
        },
        end: {
          dateTime: endDateTime,
          timeZone: IST_TIMEZONE
        },
        status: 'tentative',
        extendedProperties: {
          private: {
            bookingCode,
            isWaitlist: String(isWaitlist),
            source: 'voice-agent'
          }
        }
      };

      const response = await this.calendar.events.insert({
        calendarId: this.calendarId,
        resource: event
      });

      logger.log('mcp', `Calendar event created: ${response.data.id}`, { bookingCode, eventId: response.data.id });
      return response.data;
    } catch (error) {
      logger.log('error', `Failed to create calendar event: ${error.message}`, { params });
      throw error;
    }
  }

  /**
   * Update event time (reschedule)
   * @param {Object} params - Update parameters
   * @param {string} params.bookingCode - Booking code to find event
   * @param {string} params.newStartDateTime - New start time (ISO 8601)
   * @param {string} params.newEndDateTime - New end time (ISO 8601)
   * @returns {Promise<Object>} Updated event
   */
  async updateHoldTime(params) {
    const { bookingCode, newStartDateTime, newEndDateTime } = params;

    if (!this.isAvailable()) {
      logger.log('mcp', 'Calendar: Mock updateHoldTime', { params });
      return {
        id: `mock-${Date.now()}`,
        start: { dateTime: newStartDateTime },
        end: { dateTime: newEndDateTime },
        status: 'tentative'
      };
    }

    try {
      // Find event by booking code
      const event = await this.findEventByBookingCode(bookingCode);
      if (!event) {
        throw new Error(`Event with booking code ${bookingCode} not found`);
      }

      // Update event
      event.start.dateTime = newStartDateTime;
      event.end.dateTime = newEndDateTime;
      event.start.timeZone = IST_TIMEZONE;
      event.end.timeZone = IST_TIMEZONE;

      const response = await this.calendar.events.update({
        calendarId: this.calendarId,
        eventId: event.id,
        resource: event
      });

      logger.log('mcp', `Calendar event updated: ${event.id}`, { bookingCode, eventId: event.id });
      return response.data;
    } catch (error) {
      logger.log('error', `Failed to update calendar event: ${error.message}`, { params });
      throw error;
    }
  }

  /**
   * Cancel an event
   * @param {Object} params - Cancel parameters
   * @param {string} params.bookingCode - Booking code
   * @returns {Promise<boolean>} Success status
   */
  async cancelHold(params) {
    const { bookingCode } = params;

    if (!this.isAvailable()) {
      logger.log('mcp', 'Calendar: Mock cancelHold', { params });
      return true;
    }

    try {
      const event = await this.findEventByBookingCode(bookingCode);
      if (!event) {
        throw new Error(`Event with booking code ${bookingCode} not found`);
      }

      await this.calendar.events.delete({
        calendarId: this.calendarId,
        eventId: event.id
      });

      logger.log('mcp', `Calendar event cancelled: ${event.id}`, { bookingCode, eventId: event.id });
      return true;
    } catch (error) {
      logger.log('error', `Failed to cancel calendar event: ${error.message}`, { params });
      throw error;
    }
  }

  /**
   * Get availability for a date and time window
   * @param {Object} params - Availability parameters
   * @param {string} params.preferredDate - Date in YYYY-MM-DD format
   * @param {string} params.timeWindow - Time window (morning, afternoon, evening, any)
   * @param {number} params.slotMinutes - Slot duration in minutes (default: 30)
   * @returns {Promise<Array>} Available slots
   */
  async getAvailability(params) {
    const { preferredDate, timeWindow, slotMinutes = 30 } = params;

    if (!this.isAvailable()) {
      logger.log('mcp', 'Calendar: Mock getAvailability', { params });
      // Return mock availability (this should be handled by availabilityService in Phase 1)
      return [];
    }

    try {
      // Parse date and create time range
      const date = new Date(`${preferredDate}T00:00:00+05:30`);
      const startOfDay = formatInTimeZone(date, IST_TIMEZONE, 'yyyy-MM-dd\'T\'HH:mm:ssXXX');
      
      // Get time window bounds
      const timeWindowRanges = {
        morning: { start: 10, end: 12 },
        afternoon: { start: 12, end: 16 },
        evening: { start: 16, end: 18 },
        any: { start: 10, end: 18 }
      };

      const window = timeWindowRanges[timeWindow] || timeWindowRanges.any;
      const startTime = new Date(`${preferredDate}T${String(window.start).padStart(2, '0')}:00:00+05:30`);
      const endTime = new Date(`${preferredDate}T${String(window.end).padStart(2, '0')}:00:00+05:30`);

      // Query calendar for existing events
      const response = await this.calendar.events.list({
        calendarId: this.calendarId,
        timeMin: startTime.toISOString(),
        timeMax: endTime.toISOString(),
        singleEvents: true,
        orderBy: 'startTime'
      });

      const busySlots = (response.data.items || []).map(event => ({
        start: new Date(event.start.dateTime || event.start.date),
        end: new Date(event.end.dateTime || event.end.date)
      }));

      // Generate available slots
      const availableSlots = [];
      let currentTime = startTime;

      while (currentTime < endTime) {
        const slotEnd = addMinutes(currentTime, slotMinutes);
        
        // Check if this slot overlaps with any busy slot
        const isAvailable = !busySlots.some(busy => {
          return (currentTime < busy.end && slotEnd > busy.start);
        });

        if (isAvailable && slotEnd <= endTime) {
          availableSlots.push({
            start: formatInTimeZone(currentTime, IST_TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX"),
            end: formatInTimeZone(slotEnd, IST_TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX")
          });
        }

        currentTime = addMinutes(currentTime, 15); // Check every 15 minutes
      }

      return availableSlots.slice(0, 10); // Return up to 10 slots
    } catch (error) {
      logger.log('error', `Failed to get availability: ${error.message}`, { params });
      throw error;
    }
  }

  /**
   * Find event by booking code
   * @param {string} bookingCode - Booking code
   * @returns {Promise<Object|null>} Event or null
   */
  async findEventByBookingCode(bookingCode) {
    if (!this.isAvailable()) {
      return null;
    }

    try {
      // Search events in the next 90 days
      const timeMin = new Date().toISOString();
      const timeMax = new Date();
      timeMax.setDate(timeMax.getDate() + 90);
      const timeMaxISO = timeMax.toISOString();

      const response = await this.calendar.events.list({
        calendarId: this.calendarId,
        timeMin,
        timeMax: timeMaxISO,
        singleEvents: true,
        maxResults: 1000
      });

      // Find event with matching booking code
      for (const event of response.data.items || []) {
        if (event.extendedProperties?.private?.bookingCode === bookingCode) {
          return event;
        }
        // Also check summary for booking code (backward compatibility)
        if (event.summary?.includes(bookingCode)) {
          return event;
        }
      }

      return null;
    } catch (error) {
      logger.log('error', `Failed to find event by booking code: ${error.message}`, { bookingCode });
      return null;
    }
  }

  async _executeTool(toolName, params) {
    switch (toolName) {
      case 'event_create_tentative':
        return await this.createTentativeHold(params);
      case 'event_update_time':
        return await this.updateHoldTime(params);
      case 'event_cancel':
        return await this.cancelHold(params);
      case 'calendar_get_availability':
        return await this.getAvailability(params);
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }
}

