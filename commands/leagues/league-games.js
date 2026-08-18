'use strict';

const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const logger = require('../../utils/logger');
const { noticePayload } = require('../../utils/ui');
const { fetchLeaguesByOwner, fetchLeaguesByCoOwner, fetchLeagueByName, getLeagueGamesSummary, getLeagueWeeklyStats, fetchRecentLeagueGames } = require('../../db');
const { buildGamesSummaryLine } = require('../../utils/league_officials');
const { buildWeeklyStatsLines } = require('../../utils/league_games');

const SUB = 'League Games';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('league-games')
        .setDescription('View your league\'s games and weekly player stats')
        .addStringOption((o) => o
            .setName('league')
            .setDescription('(Staff) View a specific league by name')
            .setRequired(false)
            .setMaxLength(100)),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const userId = interaction.user.id;
            const leagueName = interaction.options.getString('league');

            let league = null;
            if (leagueName) {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
                    return interaction.editReply(noticePayload('Only staff can look up other leagues.', { title: 'Permission Denied', subtitle: SUB }));
                }
                league = await fetchLeagueByName(leagueName);
                if (!league) {
                    return interaction.editReply(noticePayload(`No league found matching "${leagueName}".`, { title: 'League Not Found', subtitle: SUB }));
                }
            } else {
                const owned = await fetchLeaguesByOwner(userId);
                const coowned = await fetchLeaguesByCoOwner(userId);
                league = [...owned, ...coowned][0] || null;
                if (!league) {
                    return interaction.editReply(noticePayload('You do not own or co-own a registered league.', { title: 'No League Found', subtitle: SUB }));
                }
            }

            const summary = await getLeagueGamesSummary(league.league_id);
            const weekly = await getLeagueWeeklyStats(league.league_id);
            const recent = await fetchRecentLeagueGames(league.league_id, 10);

            const lines = [buildGamesSummaryLine(summary)];
            lines.push('', '**Last 4 weeks:**', ...buildWeeklyStatsLines(weekly));
            if (recent.length > 0) {
                lines.push('', '**Recent games:**');
                for (const g of recent) {
                    lines.push(`- ${g.sport || 'Game'} - ${g.verification_status}`);
                }
            }

            return interaction.editReply(noticePayload(lines, { title: league.league_name, subtitle: SUB }));
        } catch (error) {
            logger.error('[Officials] league-games failed:', error);
            return interaction.editReply(noticePayload('An error occurred while fetching your games.', { title: 'Games Error', subtitle: SUB }));
        }
    },
};
