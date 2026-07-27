'use strict';

const logger = require('../utils/logger');
const { indexThread } = require('../handlers/poll_tracker');
const { nudgeNewThread } = require('../jobs/poll-nudge');

// New forum post -> index it, then post the Top 5 nudge under it so every post gets
// one instead of the three a day the batch job can reach. Tags may not be fully
// populated on create; threadUpdate and the backfill script reconcile any tags added
// right after creation, and the daily job nudges whatever this missed.
module.exports = {
    name: 'threadCreate',
    once: false,
    async execute(thread, newlyCreated) {
        try {
            if (newlyCreated === false) {
                return;
            }
            const boards = await indexThread(thread);
            await nudgeNewThread(thread, boards);
        } catch (error) {
            logger.error('[Poll] Failed to index new thread:', error);
        }
    },
};
