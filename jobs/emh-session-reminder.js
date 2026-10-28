'use strict';

// Every minute: DM each EMH host shortly before their scheduled slot starts.
// The slot is claimed in the database before the DM goes out, so a restart or
// a closed-DM host never gets the reminder twice and is never retried.

const store = require('../utils/emh_schedule_queries');
const { isReminderDue, REMINDER_LEAD_MINUTES } = require('../utils/emh_schedule');
const { sessionReminderNotice, sendHostDm } = require('../utils/host_session_dms');
const logger = require('../utils/logger');

const MINUTE_MS = 60 * 1000;

// node-cron has no overlap protection; a slow run must not race the next one.
let running = false;

const remindBooking = async (client, booking) => {
    try {
        if (!(await store.markReminderSent(booking.id))) return null;
    } catch (error) {
        logger.error(`[EMH Reminder] Could not mark slot ${booking.id} reminded:`, error.message);
        return null;
    }
    // sendHostDm logs and returns false when the host has DMs closed.
    const delivered = await sendHostDm(client, booking.hostId, sessionReminderNotice(booking));
    return { id: booking.id, delivered };
};

const sendDueReminders = async (client, now) => {
    let candidates;
    try {
        candidates = await store.listReminderCandidates(now, new Date(now.getTime() + REMINDER_LEAD_MINUTES * MINUTE_MS));
    } catch (error) {
        logger.error('[EMH Reminder] Could not load upcoming slots:', error.message);
        return [];
    }
    const sent = [];
    for (const booking of candidates.filter((b) => isReminderDue(b, now))) {
        const result = await remindBooking(client, booking);
        if (result) sent.push(result);
    }
    return sent;
};

const runEmhSessionReminders = async (client, now = new Date()) => {
    if (running) {
        logger.warn('[EMH Reminder] Previous run still going, skipping this tick.');
        return null;
    }
    running = true;
    try {
        const sent = await sendDueReminders(client, now);
        if (sent.length > 0) logger.info(`[EMH Reminder] Reminded ${sent.length} host(s).`);
        return sent;
    } finally {
        running = false;
    }
};

module.exports = { runEmhSessionReminders };
