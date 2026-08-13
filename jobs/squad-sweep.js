'use strict';

// Every-5-minute squad sweep (sub-project 2): expires stale applications and
// drives scheduled-practice timing (reminder, start, cleanup) off the
// database, so nothing depends on in-process timers.

const logger = require('../utils/logger');
const squadDb = require('../utils/squad_db');
const { finalizeApplicationCard, dmUser } = require('../handlers/squad_discovery');

const APPLICATION_EXPIRY_DAYS = 7;
const REMINDER_MINUTES = 15;
const CLEANUP_HOURS = 24;

// Guards against node-cron's lack of overlap protection.
let running = false;

async function runSquadSweep(client) {
    if (running) {
        return;
    }
    running = true;
    try {
        await sweepApplications(client);
        await sweepPractices(client);
    } catch (error) {
        logger.error('[Squad Sweep] Sweep failed:', error.message);
    } finally {
        running = false;
    }
}

async function sweepApplications(client) {
    const expired = await squadDb.expireOldApplications(APPLICATION_EXPIRY_DAYS);
    for (const application of expired) {
        try {
            const squad = await squadDb.fetchSquadById(application.squad_id);
            if (squad) {
                await finalizeApplicationCard(client, application, squad, '**Status:** Expired (no response in 7 days)');
            }
            await dmUser(client, application.user_id, {
                title: 'Application Expired',
                subtitle: squad?.name || 'Squad Recruiting',
                lines: [`Your application to **${squad?.name || 'a squad'}** expired after ${APPLICATION_EXPIRY_DAYS} days without a response. You can apply again anytime.`],
            });
            logger.info(`[Squad Sweep] Expired application ${application.id}`);
        } catch (error) {
            logger.error(`[Squad Sweep] Failed to finalize expired application ${application.id}:`, error.message);
        }
    }
}

async function sweepPractices(client) {
    // Claim-then-act everywhere: each transition only applies from its
    // expected prior state, so a cancel racing the sweep is never overwritten
    // and overlapping runs cannot double-send.
    for (const practice of await squadDb.fetchDuePracticeReminders(REMINDER_MINUTES)) {
        try {
            // ponytail: claim-before-send is at-most-once delivery. A crash
            // between claim and DMs loses that reminder rather than risking
            // duplicate DMs to the whole roster. Deliberate.
            const claimed = await squadDb.claimPracticeReminder(practice.id);
            if (!claimed) continue;
            const squad = await squadDb.fetchSquadById(practice.squad_id);
            const yes = await squadDb.fetchRsvps(practice.id, 'Yes');
            const ts = Math.floor(new Date(practice.scheduled_at).getTime() / 1000);
            const recipients = [...new Set([String(practice.created_by), ...yes.map((r) => String(r.user_id))])];
            for (const userId of recipients) {
                await dmUser(client, userId, {
                    title: 'Practice Reminder',
                    subtitle: squad?.name || 'Squad Practice',
                    lines: [`**${squad?.name || 'Your squad'}** practice starts <t:${ts}:R>. See you there!`],
                });
            }
            logger.info(`[Squad Sweep] Reminder sent for practice ${practice.id} (${recipients.length} recipients)`);
        } catch (error) {
            logger.error(`[Squad Sweep] Reminder failed for practice ${practice.id}:`, error.message);
        }
    }

    for (const practice of await squadDb.fetchDuePracticeStarts()) {
        try {
            const claimed = await squadDb.claimPracticeStart(practice.id);
            if (!claimed) continue;
            if (practice.thread_id) {
                const thread = await client.channels.fetch(practice.thread_id).catch(() => null);
                if (thread) {
                    await thread.send('Practice is starting now. Good luck!').catch(() => {});
                }
            }
            logger.info(`[Squad Sweep] Practice ${practice.id} started`);
        } catch (error) {
            logger.error(`[Squad Sweep] Start failed for practice ${practice.id}:`, error.message);
        }
    }

    for (const practice of await squadDb.fetchDuePracticeCleanups(CLEANUP_HOURS)) {
        try {
            const claimed = await squadDb.claimPracticeCleanup(practice.id);
            if (!claimed) continue;
            if (practice.thread_id) {
                const thread = await client.channels.fetch(practice.thread_id).catch(() => null);
                if (thread) {
                    await thread.delete(`Practice ended ${CLEANUP_HOURS} hours ago.`).catch(() => {});
                }
            }
            logger.info(`[Squad Sweep] Practice ${practice.id} cleaned up`);
        } catch (error) {
            logger.error(`[Squad Sweep] Cleanup failed for practice ${practice.id}:`, error.message);
        }
    }
}

module.exports = { runSquadSweep, APPLICATION_EXPIRY_DAYS, REMINDER_MINUTES, CLEANUP_HOURS };
