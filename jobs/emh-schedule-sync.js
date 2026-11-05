'use strict';

// Every 15 minutes: decide Hosted / No-Show for slots that have ended, then
// redraw the calendar and keep the Discord server events in step with the
// bookings. Statuses come from host_sessions, so resolving needs no Discord
// access. Hand-set (imported) statuses are never revisited because
// listDueBookings only returns auto, still-scheduled slots.

const store = require('../utils/emh_schedule_queries');
const { resolveStatus, EARLY_GRACE_MINUTES } = require('../utils/emh_schedule');
const { renderMonthlyView } = require('../utils/emh_schedule_sheet');
const { reconcileBookingEvent } = require('../utils/emh_events');
const logger = require('../utils/logger');

const MINUTE_MS = 60 * 1000;

// node-cron has no overlap protection; a slow run must not double-resolve.
let running = false;

const resolveDueBookings = async (now) => {
    const due = await store.listDueBookings(now);
    if (due.length === 0) return { decided: [], due };
    const from = new Date(Math.min(...due.map((b) => new Date(b.startsAt).getTime())) - EARLY_GRACE_MINUTES * MINUTE_MS);
    const to = new Date(Math.max(...due.map((b) => new Date(b.endsAt).getTime())));
    const hostIds = [...new Set(due.map((b) => b.hostId))];
    const sessions = await store.listSessionsForHosts(hostIds, from, to);
    const decided = due.map((booking) => ({ id: booking.id, status: resolveStatus(booking, sessions, now) }));
    for (const { id, status } of decided) {
        await store.setBookingStatus(id, status);
    }
    return { decided, due };
};

// node-cron has no overlap protection and Discord can be slow, so the event
// pass gets its own guard: a run that outlasts the 15-minute tick is skipped,
// never doubled. Resolved slots lose their events; upcoming slots without one
// (booked before events existed, or whose create failed) get one.
// reconcileBookingEvent re-reads each row and never throws.
let syncingEvents = false;

const syncEvents = async (client, due) => {
    if (!client || syncingEvents) return;
    syncingEvents = true;
    try {
        const missing = (await store.listUpcomingBookings()).filter((booking) => !booking.eventId);
        for (const booking of [...due, ...missing]) {
            await reconcileBookingEvent(client, booking.id);
        }
    } catch (error) {
        logger.error('[EMH Schedule] Could not sync Discord events:', error.message);
    } finally {
        syncingEvents = false;
    }
};

const runEmhScheduleSync = async (now = new Date(), { client = null } = {}) => {
    if (running) {
        logger.warn('[EMH Schedule] Previous sync still running, skipping this tick.');
        return null;
    }
    running = true;
    let decided;
    let due = [];
    try {
        ({ decided, due } = await resolveDueBookings(now));
        if (decided.length > 0) {
            logger.info(`[EMH Schedule] Resolved ${decided.length} slot(s).`);
        }
    } finally {
        running = false;
    }
    // Outside the guard: a stalled Sheets or Discord call must never stop the
    // next tick from resolving slots. The two run side by side so neither can
    // hold up the other; both log their own failures.
    await Promise.allSettled([renderMonthlyView(now), syncEvents(client, due)]);
    return decided;
};

module.exports = { runEmhScheduleSync };
