'use strict';

const logger = require('../utils/logger');
const { insertGameIdeasMessage } = require('../db');
const { GAME_IDEAS_FORUM_CHANNEL_ID } = require('../config/constants');

// Durably records every non-bot message posted inside a game-ideas forum thread.
// Used to compute participation metrics (total messages, unique participants) from
// the database rather than relying on Discord's cache or history.
module.exports = {
    name: 'messageCreate',
    once: false,
    async execute(message) {
        try {
            if (message.author?.bot) {
                return;
            }

            const channel = message.channel;
            if (!channel || typeof channel.isThread !== 'function' || !channel.isThread()) {
                return;
            }

            if (channel.parentId !== GAME_IDEAS_FORUM_CHANNEL_ID) {
                return;
            }

            await insertGameIdeasMessage({
                messageId: message.id,
                threadId: channel.id,
                authorId: message.author.id,
                createdAt: message.createdAt,
            });
        } catch (error) {
            logger.error('[GameIdeas] Failed to record thread message:', error);
        }
    },
};
