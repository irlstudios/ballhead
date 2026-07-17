'use strict';

const logger = require('../utils/logger');
const { deletePollPostBoardsExcept } = require('../db');
const { GAME_IDEAS_FORUM_CHANNEL_ID, BUG_REPORTS_FORUM_CHANNEL_ID } = require('../config/constants');

// Deleted forum post -> drop it from the catalog so it leaves leaderboards.
// Stale votes remain in poll_votes but no longer join, and a user can clear them
// from /myideas view (they render as "(removed post)").
module.exports = {
    name: 'threadDelete',
    once: false,
    async execute(thread) {
        try {
            if (!thread || (thread.parentId !== GAME_IDEAS_FORUM_CHANNEL_ID && thread.parentId !== BUG_REPORTS_FORUM_CHANNEL_ID)) {
                return;
            }
            await deletePollPostBoardsExcept(thread.id, []);
        } catch (error) {
            logger.error('[Poll] Failed to remove deleted thread:', error);
        }
    },
};
