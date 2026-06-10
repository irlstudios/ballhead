'use strict';

const logger = require('../utils/logger');
const {
    parseDynoModerationEmbed,
    extractEmbedData,
} = require('../utils/dyno_moderation_parser');
const { dispatchProgramModerationAlert } = require('../utils/program_moderation_dispatch');
const { DYNO_BOT_ID } = require('../config/constants');

// Find the first embed on the message that is a tracked Dyno moderation action.
const findModerationRecord = (message) => {
    const embeds = Array.isArray(message.embeds) ? message.embeds : [];
    for (const embed of embeds) {
        const record = parseDynoModerationEmbed(extractEmbedData(embed));
        if (record) {
            return record;
        }
    }
    return null;
};

module.exports = {
    name: 'messageCreate',
    once: false,
    async execute(message) {
        try {
            if (message.author?.id !== DYNO_BOT_ID) {
                return;
            }
            if (!Array.isArray(message.embeds) || message.embeds.length === 0) {
                return;
            }

            const record = findModerationRecord(message);
            if (!record) {
                return;
            }

            await dispatchProgramModerationAlert({
                message,
                record,
                source: 'DynoModAlert',
                logLabel: 'Dyno log',
                origin: 'Discord (Dyno)',
            });
        } catch (error) {
            logger.error('[DynoModAlert] Failed to process Dyno moderation log:', error);
        }
    },
};
