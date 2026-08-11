'use strict';

const logger = require('../utils/logger');
const { WEEKLY_DISCUSSION_CHANNEL_ID, WEEKLY_FEEDBACK_ROLE_IDS } = require('../config/constants');

// Grants the feedback participant/XP roles to anyone who posts in a
// "Weekly Discussion: <topic>" thread created by /weekly-thread.
module.exports = {
    name: 'messageCreate',
    once: false,
    async execute(message) {
        try {
            if (message.author?.bot) {
                return;
            }
            const channel = message.channel;
            if (!channel?.isThread?.() || channel.parentId !== WEEKLY_DISCUSSION_CHANNEL_ID) {
                return;
            }
            if (!channel.name?.startsWith('Weekly Discussion')) {
                return;
            }
            // Only bot-created threads count; anyone can start a thread in
            // general with this name and would otherwise self-award the roles.
            if (channel.ownerId !== message.client.user.id) {
                return;
            }

            const member = message.member ?? await message.guild.members.fetch(message.author.id);
            const missing = WEEKLY_FEEDBACK_ROLE_IDS.filter((id) => !member.roles.cache.has(id));
            if (missing.length === 0) {
                return;
            }
            await member.roles.add(missing, 'Posted in the weekly discussion thread');
        } catch (error) {
            logger.error('[WeeklyThread] Failed to grant feedback roles:', error);
        }
    },
};
