const { MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const logger = require('../utils/logger');
const { insertAnalyticsEvent } = require('../db');

// "id" on its own is the common phrasing ("whats my id"), so every pattern
// below anchors on "my" to keep out people asking about someone else's id,
// and on a question or request verb to keep out "my discord id is 1234".
const ID = '(?:(?:discord|user|account)\\s+)?(?:user\\s+)?id';
const ASKER = '(?:anyone|any1|someone|somebody|anybody|sum1|you|u|yall)';
const HAND_OVER = '(?:send|tell|give|show|get|find|know|copy|retrieve)';

const idQuestionPatterns = [
    new RegExp(`\\bwhat(?:s|\\s+is)?\\s+my\\s+${ID}\\b`),
    new RegExp(`\\bwhere(?:s|\\s+is)?\\s+my\\s+${ID}\\b`),
    new RegExp(`\\b(?:how|where)\\b[\\w\\s]{0,20}\\b(?:get|find|see|check|view|copy|know)\\s+my\\s+${ID}\\b`),
    new RegExp(`\\b${ASKER}\\b[\\w\\s]{0,20}\\b${HAND_OVER}\\s+(?:me\\s+)?my\\s+${ID}\\b`),
    new RegExp(`\\b${HAND_OVER}\\s+me\\s+my\\s+${ID}\\b`),
    new RegExp(`\\b(?:need|want)\\s+(?:to\\s+know\\s+)?my\\s+${ID}\\b`),
];

// One answer per person per minute: the reply is the same every time, so a
// spammed question should not turn into a wall of bot posts.
// ponytail: plain Map, one entry per asker; prune it if it ever grows enough to matter.
const REPLY_COOLDOWN_MS = 60000;
const lastReplyAt = new Map();

// Matched per sentence so an asker in one clause cannot pair up with a verb
// in the next ("Can anyone help? My discord id is on my profile.").
const matchesIdQuestion = (content) => {
    const clauses = String(content || '').split(/[.!?;\n]+/);
    return clauses.some((clause) => {
        const sanitized = clause
            .toLowerCase()
            .replace(/['’]/g, '')
            .replace(/[^a-z0-9\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return idQuestionPatterns.some((pattern) => pattern.test(sanitized));
    });
};

module.exports = {
    name: 'messageCreate',
    once: false,
    matchesIdQuestion,
    async execute(message) {
        if (message.author.bot) return;
        if (!matchesIdQuestion(message.content)) return;

        const userId = message.author.id;
        const now = Date.now();
        if (now - (lastReplyAt.get(userId) ?? 0) < REPLY_COOLDOWN_MS) return;
        lastReplyAt.set(userId, now);

        try {
            const container = new ContainerBuilder();
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent('## Your Discord ID'));
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
                `Hey <@${userId}>! Your Discord ID is:`,
                '```',
                userId,
                '```',
                '-# Need someone else\'s? Turn on Settings > Advanced > Developer Mode, then right click their profile and pick Copy User ID.',
            ].join('\n')));
            await message.reply({ flags: MessageFlags.IsComponentsV2, components: [container] });
        } catch (error) {
            logger.error('[Discord ID Question Listener] Failed to reply:', error);
            return;
        }

        try {
            await insertAnalyticsEvent('Discord ID Question Response', userId, {
                channel_id: String(message.channelId),
                server_id: message.guildId ? String(message.guildId) : 'dm',
            });
        } catch (error) {
            logger.error('[Discord ID Question Listener] Failed to store analytics event:', error);
        }
    },
};
