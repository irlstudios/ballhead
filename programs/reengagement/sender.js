'use strict';

const logger = require('../../utils/logger');
const { config, getAllowlist } = require('./config');
const { buildReengagementMessage } = require('./message_builder');
const {
    reserveReengagementOutreach,
    updateReengagementOutreachStatus,
    isOptedOutOfReengagement,
} = require('../../db');

const DM_BLOCKED_CODE = 50007;

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Real DM delivery. Returns the sent message id; throws on failure, preserving
// Discord's error code so the caller can distinguish a blocked DM (50007).
const defaultSendDm = async (client, userId, payload) => {
    const user = await client.users.fetch(userId);
    const message = await user.send(payload);
    return message.id;
};

// Sends the re-engagement DM to a batch of targets, applying every safety rail:
// recipient allowlist, opt-out, once-per-lapse dedup, per-run cap, throttle, and
// blocked-DM handling. All side-effecting collaborators are injectable so the
// rails can be tested without Discord or a database.
async function sendReengagementBatch({ client, adapter, targets, deps = {} }) {
    const {
        allowlist = getAllowlist(),
        isOptedOut = isOptedOutOfReengagement,
        reserve = reserveReengagementOutreach,
        updateStatus = updateReengagementOutreachStatus,
        getChangelog = (season) => adapter.getChangelogSince(season),
        sendDm = defaultSendDm,
        sleep = defaultSleep,
        maxPerRun = config.MAX_PER_RUN,
        throttleMs = config.THROTTLE_MS,
        log = logger,
    } = deps;

    const allowSet = new Set(allowlist);
    const summary = { attempted: 0, sent: 0, skipped: 0, dmBlocked: 0, failed: 0, deduped: 0 };

    for (const target of targets) {
        if (summary.attempted >= maxPerRun) {
            log.info(`[Reengage] Per-run cap (${maxPerRun}) reached; stopping.`);
            break;
        }

        if (allowSet.size > 0 && !allowSet.has(String(target.userId))) {
            summary.skipped += 1;
            continue;
        }

        if (await isOptedOut(target.userId)) {
            summary.skipped += 1;
            continue;
        }

        const outreachId = await reserve({
            userId: target.userId,
            program: adapter.id,
            inGameName: target.inGameName,
            lastActiveSeason: target.lastActiveSeason,
            lapsedSeasons: target.lapsedSeasons,
        });
        if (outreachId === null) {
            // Already contacted for this lapse.
            summary.deduped += 1;
            continue;
        }

        summary.attempted += 1;
        try {
            const changelog = await getChangelog(target.lastActiveSeason);
            const payload = buildReengagementMessage({
                member: target,
                changelog,
                program: adapter.id,
            });
            const messageId = await sendDm(client, target.userId, payload);
            await updateStatus(outreachId, 'sent', { messageId });
            summary.sent += 1;
            log.info(`[Reengage] Sent ${adapter.id} DM to ${target.userId} (${target.inGameName}).`);
        } catch (error) {
            if (error?.code === DM_BLOCKED_CODE) {
                await updateStatus(outreachId, 'dm_blocked', { error: 'Cannot send DM to user' });
                summary.dmBlocked += 1;
                log.info(`[Reengage] DM blocked for ${target.userId}.`);
            } else {
                await updateStatus(outreachId, 'failed', { error: error.message });
                summary.failed += 1;
                log.error(`[Reengage] Failed to DM ${target.userId}: ${error.message}`);
            }
        }

        if (summary.attempted < maxPerRun && throttleMs > 0) {
            await sleep(throttleMs);
        }
    }

    return summary;
}

module.exports = {
    sendReengagementBatch,
    defaultSendDm,
    DM_BLOCKED_CODE,
};
