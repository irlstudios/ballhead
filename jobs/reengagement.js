'use strict';

const logger = require('../utils/logger');
const { getAdapters } = require('../programs/reengagement/registry');
const { sendReengagementBatch } = require('../programs/reengagement/sender');
const { isEnabled, getForceUserIds } = require('../programs/reengagement/config');

// Resolves the targets for one adapter. In force mode (testing) it injects the
// configured user IDs as synthetic targets; otherwise it runs real churn
// detection.
async function resolveTargets(adapter, force) {
    if (force) {
        const forced = getForceUserIds();
        if (forced.length === 0) {
            logger.warn('[Reengage] Force mode requested but REENGAGE_FORCE_USER_IDS is empty.');
            return [];
        }
        if (typeof adapter.getForcedTargets !== 'function') {
            return [];
        }
        return adapter.getForcedTargets(forced);
    }
    return adapter.getLapsedMembers();
}

// Runs one re-engagement sweep across all registered programs.
//   opts.force - bypass churn detection and use REENGAGE_FORCE_USER_IDS (test).
async function runReengagementSweep(client, opts = {}) {
    const { force = false } = opts;

    if (!force && !isEnabled()) {
        logger.info('[Reengage] Sweep skipped (REENGAGE_ENABLED is not "true").');
        return [];
    }

    const summaries = [];
    for (const adapter of getAdapters()) {
        try {
            const targets = await resolveTargets(adapter, force);
            logger.info(`[Reengage] ${adapter.id}: ${targets.length} candidate target(s).`);
            const summary = await sendReengagementBatch({ client, adapter, targets });
            summaries.push({ program: adapter.id, ...summary });
            logger.info(
                `[Reengage] ${adapter.id} done: sent=${summary.sent} skipped=${summary.skipped} `
                + `deduped=${summary.deduped} blocked=${summary.dmBlocked} failed=${summary.failed}.`,
            );
        } catch (error) {
            logger.error(`[Reengage] Sweep failed for ${adapter.id}: ${error.message}`);
            summaries.push({ program: adapter.id, error: error.message });
        }
    }
    return summaries;
}

module.exports = { runReengagementSweep, resolveTargets };
