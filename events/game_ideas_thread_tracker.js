'use strict';

const logger = require('../utils/logger');
const { insertGameIdeasThread } = require('../db');
const { GAME_IDEAS_FORUM_CHANNEL_ID } = require('../config/constants');

// Durably records every new post/thread created in the game-ideas forum.
// Used to compute the weekly count of posts and to list thread links.
module.exports = {
    name: 'threadCreate',
    once: false,
    async execute(thread, newlyCreated) {
        try {
            if (newlyCreated === false) {
                return;
            }

            if (!thread || thread.parentId !== GAME_IDEAS_FORUM_CHANNEL_ID) {
                return;
            }

            await insertGameIdeasThread({
                threadId: thread.id,
                starterId: thread.ownerId || null,
                name: thread.name || null,
                url: thread.url || null,
                createdAt: thread.createdAt,
            });
        } catch (error) {
            logger.error('[GameIdeas] Failed to record new thread:', error);
        }
    },
};
