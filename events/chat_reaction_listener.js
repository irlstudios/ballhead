const { Events } = require('discord.js');
const cron = require('node-cron');
const logger = require('../utils/logger');

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        const channelId = '1036677798187778100';

        cron.schedule('0 * * * *', async () => {
            try {
                const channel = await client.channels.fetch(channelId);
                if (!channel || !channel.isTextBased()) {
                    return;
                }

                const messages = await channel.messages.fetch({ limit: 100, cache: true });

                for (const [messageId, message] of messages) {
                    try {
                        if (message.partial) {
                            await message.fetch();
                        }
                        const reaction = message.reactions.cache.find(r => r.emoji.name === '❌');
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
        });
    },
};
