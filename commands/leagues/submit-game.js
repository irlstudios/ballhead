'use strict';

const { SlashCommandBuilder } = require('discord.js');
const logger = require('../../utils/logger');
const { noticePayload } = require('../../utils/ui');
const { fetchLeaguesByOwner, fetchLeaguesByCoOwner, insertLeagueGameWithPlayers } = require('../../db');
const { parsePlayerIds, validateGameSubmission, OWNER_REPORTED_STATUS } = require('../../utils/league_games');

const SUB = 'Submit Game';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('submit-game')
        .setDescription('Record a completed league game by tagging the players')
        .addStringOption((o) => o
            .setName('players')
            .setDescription('@mention every player who played in the game')
            .setRequired(true)
            .setMaxLength(1000))
        .addStringOption((o) => o
            .setName('sport')
            .setDescription('Sport / format, defaults to your league\'s sport')
            .setRequired(false)
            .setMaxLength(60)),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const userId = interaction.user.id;
            const owned = await fetchLeaguesByOwner(userId);
            const coowned = await fetchLeaguesByCoOwner(userId);
            const league = [...owned, ...coowned][0] || null;

            const playerIds = parsePlayerIds(interaction.options.getString('players'));
            const verdict = validateGameSubmission({ league, playerIds });
            if (!verdict.ok) {
                return interaction.editReply(noticePayload(verdict.message, { title: verdict.title, subtitle: SUB }));
            }

            // Trust boundary: only real, non-bot server members count. Blocks
            // fabricated ids, role/channel mentions, and bots from inflating
            // the unique-player metrics.
            const members = await interaction.guild.members.fetch({ user: playerIds });
            const invalid = playerIds.filter((id) => !members.has(id) || members.get(id).user.bot);
            if (invalid.length > 0) {
                return interaction.editReply(noticePayload(
                    `These are not members of this server (or are bots): ${invalid.map((id) => `<@${id}>`).join(' ')}. Tag real players only.`,
                    { title: 'Invalid Players', subtitle: SUB }
                ));
            }

            const sport = interaction.options.getString('sport') || league.sport || null;
            await insertLeagueGameWithPlayers({
                leagueId: league.league_id,
                sport,
                status: OWNER_REPORTED_STATUS,
                submittedBy: userId,
                playerIds,
            });

            return interaction.editReply(noticePayload(
                [
                    `Game recorded for **${league.league_name}**${sport ? ` (${sport})` : ''}.`,
                    `**Players (${playerIds.length}):** ${playerIds.map((id) => `<@${id}>`).join(' ')}`,
                ],
                { title: 'Game Recorded', subtitle: SUB }
            ));
        } catch (error) {
            logger.error('[Games] submit-game failed:', error);
            return interaction.editReply(noticePayload('An error occurred while recording the game.', { title: 'Submit Error', subtitle: SUB }));
        }
    },
};
