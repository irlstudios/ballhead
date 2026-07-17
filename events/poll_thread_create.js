'use strict';

const logger = require('../utils/logger');
const { indexThread } = require('../handlers/poll_tracker');

// New forum post -> index it. Tags may not be fully populated on create; threadUpdate
// and the backfill script reconcile any tags added right after creation.
module.exports = {
    name: 'threadCreate',
    once: false,
    async execute(thread, newlyCreated) {
        try {
            if (newlyCreated === false) {
                return;
            }
            await indexThread(thread);
        } catch (error) {
            logger.error('[Poll] Failed to index new thread:', error);
        }
    },
};
