'use strict';

// Every 15 minutes: decide Hosted / No-Show for slots that have ended, then
// redraw the calendar. Statuses come from host_sessions, so this needs no
// Discord access. Hand-set (imported) statuses are never revisited because
// listDueBookings only returns auto, still-scheduled slots.

const store = require('../utils/emh_schedule_queries');
const { resolveStatus, EARLY_GRACE_MINUTES } = require('../utils/emh_schedule');
const { renderMonthlyView } = require('../utils/emh_schedule_sheet');
const logger = require('../utils/logger');

const MINUTE_MS = 60 * 1000;

// node-cron has no overlap protection; a slow run must not double-resolve.
let running = false;

const resolveDueBookings = async (now) => {
    const due = await store.listDueBookings(now);
    if (due.length === 0) return [];
    const from = new Date(Math.min(...due.map((b) => new Date(b.startsAt).getTime())) - EARLY_GRACE_MINUTES * MINUTE_MS);
    const to = new Date(Math.max(...due.map((b) => new Date(b.endsAt).getTime())));
    const hostIds = [...new Set(due.map((b) => b.hostId))];
    const sessions = await store.listSessionsForHosts(hostIds, from, to);
    const decided = due.map((booking) => ({ id: booking.id, status: resolveStatus(booking, sessions, now) }));
    for (const { id, status } of decided) {
        await store.setBookingStatus(id, status);
    }
    return decided;
};

const runEmhScheduleSync = async (now = new Date()) => {
    if (running) {
        logger.warn('[EMH Schedule] Previous sync still running, skipping this tick.');
        return null;
    }
    running = true;
    try {
        const decided = await resolveDueBookings(now);
        if (decided.length > 0) {
            logger.info(`[EMH Schedule] Resolved ${decided.length} slot(s).`);
        }
        await renderMonthlyView(now);
        return decided;
    } finally {
        running = false;
    }
};

module.exports = { runEmhScheduleSync };
