'use strict';

const { SlashCommandBuilder } = require('discord.js');
const logger = require('../../utils/logger');
const { noticePayload } = require('../../utils/ui');
const { fetchLeaguesByOwner, fetchLeaguesByCoOwner, getLeagueGamesSummary, fetchRecentLeagueGames } = require('../../db');
const { buildGamesSummaryLine } = require('../../utils/league_officials');

const SUB = 'League Games';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('league-games')
        .setDescription('View your league\'s verified and reported games'),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const userId = interaction.user.id;
            const owned = await fetchLeaguesByOwner(userId);
            const coowned = await fetchLeaguesByCoOwner(userId);
            const league = [...owned, ...coowned][0] || null;

            if (!league) {
                return interaction.editReply(noticePayload('You do not own or co-own a registered league.', { title: 'No League Found', subtitle: SUB }));
            }

            const summary = await getLeagueGamesSummary(league.league_id);
            const recent = await fetchRecentLeagueGames(league.league_id, 10);

            const lines = [buildGamesSummaryLine(summary)];
            if (recent.length > 0) {
                lines.push('', '**Recent games:**');
                for (const g of recent) {
                    lines.push(`- ${g.sport || 'Game'} — ${g.verification_status}`);
                }
            }

            return interaction.editReply(noticePayload(lines, { title: league.league_name, subtitle: SUB }));
        } catch (error) {
            logger.error('[Officials] league-games failed:', error);
            return interaction.editReply(noticePayload('An error occurred while fetching your games.', { title: 'Games Error', subtitle: SUB }));
        }
    },
};
