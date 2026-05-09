'use strict';

const logger = require('../utils/logger');

const CHANNEL_ID = '1036677798187778100';

async function cleanReactedMessages(client) {
    try {
        const channel = await client.channels.fetch(CHANNEL_ID);
        if (!channel || !channel.isTextBased()) {
            return;
        }

        const messages = await channel.messages.fetch({ limit: 100, cache: true });

        for (const [messageId, message] of messages) {
            try {
                if (message.partial) {
                    await message.fetch();
                }
                const reaction = message.reactions.cache.find(r => r.emoji.name === '\u274C');
                if (reaction) {
                    await message.delete();
                }
            } catch (messageError) {
                logger.error(`Failed to process message ID ${messageId}:`, messageError);
            }
        }
    } catch (error) {
        logger.error('Error fetching and cleaning messages from channel:', error);
    }
}

module.exports = { cleanReactedMessages };
