'use strict';

const logger = require('../utils/logger');
const { parseInGameBanMessage } = require('../utils/ingame_ban_parser');
const { dispatchProgramModerationAlert } = require('../utils/program_moderation_dispatch');
const { INGAME_BAN_BOT_ID, INGAME_BAN_CHANNEL_ID } = require('../config/constants');

// Listens for the in-game ban bot's plain-text ban announcements in the bans
// channel, parses them, and alerts the relevant program lead(s) when the banned
// player is a program member. Mirrors the Dyno embed flow but for a bot that
// posts text rather than embeds; bans where the player has no linked Discord
// (empty <@> mention) carry no user id and are skipped by the dispatcher.
module.exports = {
    name: 'messageCreate',
    once: false,
    async execute(message) {
        try {
            if (message.author?.id !== INGAME_BAN_BOT_ID) {
                return;
            }
            if (message.channelId !== INGAME_BAN_CHANNEL_ID) {
                return;
            }

            const record = parseInGameBanMessage(message.content);
            if (!record) {
                return;
            }

            await dispatchProgramModerationAlert({
                message,
                record,
                source: 'InGameBanAlert',
                logLabel: 'ban message',
                origin: 'In-game ban',
            });
        } catch (error) {
            logger.error('[InGameBanAlert] Failed to process in-game ban message:', error);
        }
    },
};
