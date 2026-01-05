
import { bookingStore } from './src/services/bookingStore.js';
import { logger } from './src/utils/logger.js';

async function run() {
    await bookingStore.initialize();
    const bookings = bookingStore.getAll();
    console.log('--- BOOKINGS DUMP ---');
    for (const [code, booking] of Object.entries(bookings)) {
        console.log(`Code: ${code}, Topic: "${booking.topic}", Status: ${booking.action}, Waitlist: ${booking.isWaitlist}, Slot: ${booking.slot}`);
    }
    console.log('---------------------');
}

run().catch(err => console.error(err));
