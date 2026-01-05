/**
 * Booking Store Service
 * Lightweight NoSQL database using a hash-map for managing booking metadata.
 * Uses JSON for persistent storage.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';
import { formatIST12HourWithSeconds, parseIST12HourWithSeconds, formatIST12Hour, parseIST12Hour } from '../utils/timezone.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'bookings.json');

class BookingStore {
    constructor() {
        this.bookings = new Map(); // bookingCode -> metadata
        this.slots = new Map();    // timeSlot (ISO) -> bookingCode
        this.initialized = false;
    }

    /**
     * Initialize the store by loading from JSON
     */
    async initialize() {
        if (this.initialized) return;

        try {
            // Ensure data directory exists
            try {
                await fs.mkdir(DATA_DIR, { recursive: true });
            } catch (err) {
                // Ignore if exists
            }

            // Check if DB file exists
            try {
                const data = await fs.readFile(DB_PATH, 'utf-8');
                const parsed = JSON.parse(data);

                // Load into memory
                if (parsed.bookings) {
                    for (const [code, info] of Object.entries(parsed.bookings)) {
                        // Convert old ISO format to IST 12-hour format if needed
                        const convertedInfo = this.convertToIST12HourFormat(info);
                        this.bookings.set(code, convertedInfo);
                        // For slot mapping, use UTC ISO for internal calculations
                        if (convertedInfo.slot) {
                            const slotUTC = this.getSlotAsUTC(convertedInfo.slot);
                            if (slotUTC) {
                                this.slots.set(slotUTC.toISOString(), code);
                            }
                        }
                    }
                }

                logger.log('system', `BookingStore initialized with ${this.bookings.size} records`, {});
            } catch (err) {
                if (err.code === 'ENOENT') {
                    // File doesn't exist yet, start with empty maps
                    logger.log('system', 'BookingStore: No existing database found, starting fresh', {});
                    await this.save();
                } else {
                    logger.log('error', `BookingStore: Failed to load database: ${err.message}`, { error: err.stack });
                }
            }

            this.initialized = true;
        } catch (error) {
            logger.log('error', `BookingStore initialization failed: ${error.message}`, { error: error.stack });
        }
    }

    /**
     * Save the current state to JSON (all dates in IST 12-hour format)
     */
    async save() {
        try {
            // Convert all bookings to IST 12-hour format for storage
            const bookingsForStorage = {};
            for (const [code, info] of this.bookings.entries()) {
                bookingsForStorage[code] = this.convertToIST12HourFormat(info);
            }
            
            const data = {
                bookings: bookingsForStorage,
                lastUpdated: formatIST12HourWithSeconds(new Date())
            };
            await fs.writeFile(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
        } catch (error) {
            logger.log('error', `BookingStore: Failed to save database: ${error.message}`, { error: error.stack });
        }
    }
    
    /**
     * Convert booking info to IST 12-hour format for storage
     * @param {Object} info - Booking info object
     * @returns {Object} Booking info with dates in IST 12-hour format
     */
    convertToIST12HourFormat(info) {
        const converted = { ...info };
        
        // Convert slot dates to IST 12-hour format
        if (converted.slot) {
            converted.slot = this.getSlotAsIST12Hour(converted.slot);
        }
        if (converted.endSlot) {
            converted.endSlot = this.getSlotAsIST12Hour(converted.endSlot);
        }
        if (converted.createdAt) {
            converted.createdAt = this.getSlotAsIST12Hour(converted.createdAt);
        }
        if (converted.updatedAt) {
            converted.updatedAt = this.getSlotAsIST12Hour(converted.updatedAt);
        }
        
        return converted;
    }
    
    /**
     * Get slot as IST 12-hour format string
     * Handles both ISO format (old) and IST 12-hour format (new)
     * @param {string} slot - Slot in ISO or IST 12-hour format
     * @returns {string} Slot in IST 12-hour format
     */
    getSlotAsIST12Hour(slot) {
        if (!slot) return null;
        
        // Check if already in IST 12-hour format (contains AM/PM)
        if (typeof slot === 'string' && (slot.includes(' AM') || slot.includes(' PM'))) {
            return slot;
        }
        
        // Convert from ISO to IST 12-hour format
        try {
            return formatIST12HourWithSeconds(slot);
        } catch (e) {
            logger.log('error', `Failed to convert slot to IST 12-hour: ${slot}`, { error: e.message });
            return slot; // Return as-is if conversion fails
        }
    }
    
    /**
     * Get slot as UTC Date object for calculations
     * Handles both ISO format (old) and IST 12-hour format (new)
     * @param {string} slot - Slot in ISO or IST 12-hour format
     * @returns {Date|null} UTC Date object
     */
    getSlotAsUTC(slot) {
        if (!slot) return null;
        
        // Check if in IST 12-hour format (contains AM/PM)
        if (typeof slot === 'string' && (slot.includes(' AM') || slot.includes(' PM'))) {
            return parseIST12HourWithSeconds(slot);
        }
        
        // Already in ISO format
        try {
            return new Date(slot);
        } catch (e) {
            logger.log('error', `Failed to parse slot: ${slot}`, { error: e.message });
            return null;
        }
    }

    /**
     * Create or update a booking
     */
    async setBooking(bookingCode, metadata) {
        if (!this.initialized) await this.initialize();

        // Ensure mandatory fields - convert to IST 12-hour format for storage
        const record = {
            createdAt: this.getSlotAsIST12Hour(metadata.createdAt || new Date().toISOString()),
            topic: metadata.topic,
            slot: this.getSlotAsIST12Hour(metadata.slot),
            endSlot: this.getSlotAsIST12Hour(metadata.endSlot),
            bookingCode: bookingCode,
            isWaitlist: metadata.isWaitlist || false,
            action: metadata.action || 'Created',
            eventId: metadata.eventId || null,
            updatedAt: this.getSlotAsIST12Hour(new Date().toISOString())
        };

        // Check for conflicts if not already a waitlist (use UTC for calculations)
        if (!record.isWaitlist && record.slot && record.endSlot) {
            const slotUTC = this.getSlotAsUTC(record.slot);
            const endSlotUTC = this.getSlotAsUTC(record.endSlot);
            if (slotUTC && endSlotUTC) {
                const hasConflict = this.checkConflict(slotUTC.toISOString(), endSlotUTC.toISOString(), bookingCode);
                if (hasConflict) {
                    record.isWaitlist = true;
                    logger.log('system', `BookingStore: Conflict detected for ${bookingCode}, marking as waitlist`, { bookingCode, slot: record.slot });
                }
            }
        }

        // If updating, remove old slot mapping (use UTC for internal mapping)
        const existing = this.bookings.get(bookingCode);
        if (existing && existing.slot) {
            const existingSlotUTC = this.getSlotAsUTC(existing.slot);
            if (existingSlotUTC) {
                this.slots.delete(existingSlotUTC.toISOString());
            }
        }

        // Add new booking
        this.bookings.set(bookingCode, record);

        // Only map to slots if NOT waitlisted (slots map uses UTC ISO for internal calculations)
        if (record.slot && !record.isWaitlist) {
            const slotUTC = this.getSlotAsUTC(record.slot);
            if (slotUTC) {
                this.slots.set(slotUTC.toISOString(), bookingCode);
            }
        }

        await this.save();
        logger.log('system', `BookingStore: Stored booking ${bookingCode} (Waitlist: ${record.isWaitlist}, Action: ${record.action})`, { bookingCode, slot: record.slot });
        return record;
    }

    /**
     * Check for range-based conflicts
     * @param {string} startISO - Start time in ISO format (UTC)
     * @param {string} endISO - End time in ISO format (UTC)
     * @param {string} excludeBookingCode - Booking code to exclude from check
     * @returns {boolean} True if conflict exists
     */
    checkConflict(startISO, endISO, excludeBookingCode = null) {
        const start = new Date(startISO).getTime();
        const end = new Date(endISO).getTime();

        for (const [code, booking] of this.bookings.entries()) {
            // Skip if:
            // 1. Same booking code
            // 2. Is Waitlist (waitlists don't block slots)
            // 3. Status is Cancelled (case insensitive check)
            // 4. Missing slot data
            if (code === excludeBookingCode ||
                booking.isWaitlist ||
                (booking.action && booking.action.toLowerCase() === 'cancelled') ||
                !booking.slot || !booking.endSlot) {
                continue;
            }

            // Convert booking slots to UTC for comparison
            const bStartUTC = this.getSlotAsUTC(booking.slot);
            const bEndUTC = this.getSlotAsUTC(booking.endSlot);
            
            if (!bStartUTC || !bEndUTC) continue;
            
            const bStart = bStartUTC.getTime();
            const bEnd = bEndUTC.getTime();

            // Overlap check
            if ((start < bEnd && end > bStart)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Retrieve a booking by code
     */
    getBooking(bookingCode) {
        return this.bookings.get(bookingCode);
    }

    /**
     * Retrieve a booking by time slot
     */
    getBookingBySlot(timeSlotISO) {
        const code = this.slots.get(timeSlotISO);
        return code ? { ...this.bookings.get(code), bookingCode: code } : null;
    }

    /**
     * Check if a time slot is already booked in the store
     */
    isSlotBooked(timeSlotISO) {
        return this.slots.has(timeSlotISO);
    }

    /**
     * Delete a booking
     */
    async deleteBooking(bookingCode) {
        if (!this.initialized) await this.initialize();

        const existing = this.bookings.get(bookingCode);
        if (existing) {
            // Mark as cancelled instead of deleting for history
            const record = {
                ...existing,
                action: 'Cancelled',
                updatedAt: this.getSlotAsIST12Hour(new Date().toISOString())
            };

            // Remove from active slots mapping
            if (existing.slot) {
                this.slots.delete(existing.slot);
            }

            this.bookings.set(bookingCode, record);
            await this.save();
            logger.log('system', `BookingStore: Marked booking ${bookingCode} as Cancelled`, { bookingCode });
            return true;
        }
        return false;
    }

    /**
     * Get all booking slots within a range (machine-readable)
     */
    getBookedSlotsInRange(startISO, endISO) {
        const booked = [];
        const start = new Date(startISO).getTime();
        const end = new Date(endISO).getTime();

        for (const [slot, code] of this.slots.entries()) {
            const slotTime = new Date(slot).getTime();
            if (slotTime >= start && slotTime <= end) {
                const info = this.bookings.get(code);
                // Double check status to ensure cancelled bookings are never returned
                // Valid bookings must exist, not be waitlisted, and not be cancelled
                if (info && !info.isWaitlist && info.action && info.action.toLowerCase() !== 'cancelled') {
                    // Return in ISO format for API compatibility
                    const endSlotUTC = info.endSlot ? this.getSlotAsUTC(info.endSlot) : new Date(slotTime + 30 * 60 * 1000);
                    booked.push({
                        start: slot, // Already in ISO format from slots map
                        end: endSlotUTC ? endSlotUTC.toISOString() : new Date(slotTime + 30 * 60 * 1000).toISOString(),
                        bookingCode: code,
                        eventId: info.eventId
                    });
                }
            }
        }
        return booked;
    }

    /**
     * Get all entries
     */
    getAll() {
        return Object.fromEntries(this.bookings);
    }
}

// Single instance for the application
export const bookingStore = new BookingStore();
