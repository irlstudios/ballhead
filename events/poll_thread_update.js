'use strict';

const logger = require('../utils/logger');
const { indexThread } = require('../handlers/poll_tracker');

// Tags (or title) changed -> re-reconcile the post's boards.
module.exports = {
    name: 'threadUpdate',
    once: false,
    async execute(oldThread, newThread) {
        try {
            await indexThread(newThread);
        } catch (error) {
            logger.error('[Poll] Failed to re-index updated thread:', error);
        }
    },
};
