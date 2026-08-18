const { MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const logger = require('../utils/logger');
const { insertAnalyticsEvent } = require('../db');
const { CDT_DESIGNS_FORUM_CHANNEL_ID } = require('../config/constants');

const ASKER = '(?:anyone|any1|someone|somebody|anybody|who|whos)';
const NOUN = '(?:court|courts|backboard|backboards)';
// Requiring a determiner ("me a court", "custom courts") is what keeps
// courtroom talk out: "make it to court" and "makes the court decisions"
// have no a/an/custom before the noun.
const OBJ = `(?:(?:me|us)\\s+)?(?:a|an|any|some|more|another|custom)\\s+(?:custom\\s+)?${NOUN}`;
const MAKE_VERBS = '(?:make|makes|making|made|build|builds|building|built|create|creates|creating|created|design|designs|designing|designed)';

const courtQuestionPatterns = [
    new RegExp(`\\b${ASKER}\\b[\\w\\s]{0,40}\\b${MAKE_VERBS}\\s+${OBJ}\\b`),
    new RegExp(`\\b${ASKER}\\b[\\w\\s]{0,40}\\b(?:has|have|having|had|got|share|send|give|drop)\\s+${OBJ}\\b`),
    new RegExp(`\\b(?:where|how)\\b[\\w\\s]{0,20}\\b(?:get|find|download|grab)\\s+${OBJ}\\b`),
];

// Each sentence is matched on its own so an asker in one clause cannot
// combine with a verb in the next ("Can anyone help? I can make a court.").
const matchesCourtQuestion = (content) => {
    const clauses = String(content || '').split(/[.!?;\n]+/);
    return clauses.some((clause) => {
        const sanitized = clause
            .toLowerCase()
            .replace(/['’]/g, '')
            .replace(/[^a-z0-9\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return courtQuestionPatterns.some((pattern) => pattern.test(sanitized));
    });
};

module.exports = {
    name: 'messageCreate',
    once: false,
    matchesCourtQuestion,
    async execute(message) {
        if (message.author.bot) return;
        if (message.channel.isDMBased()) return;
        if (message.channelId === CDT_DESIGNS_FORUM_CHANNEL_ID) return;
        if (message.channel.parentId === CDT_DESIGNS_FORUM_CHANNEL_ID) return;
        if (!matchesCourtQuestion(message.content)) return;

        try {
            const container = new ContainerBuilder();
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent('## Custom Courts'));
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
                `Hey <@${message.author.id}>! Looking for a custom court?`,
                `Check out <#${CDT_DESIGNS_FORUM_CHANNEL_ID}> — it's full of community-made courts and backboards.`,
                'Every post has a **Get Files** button so you can download the design and use it in game.',
            ].join('\n')));
            await message.reply({ flags: MessageFlags.IsComponentsV2, components: [container] });
        } catch (error) {
            logger.error('[Court Question Listener] Failed to reply:', error);
            return;
        }

        try {
            await insertAnalyticsEvent('Court Question Response', message.author.id, {
                channel_id: String(message.channelId),
                server_id: String(message.guildId),
            });
        } catch (error) {
            logger.error('[Court Question Listener] Failed to store analytics event:', error);
        }
    },
};
