'use strict';

const { SlashCommandBuilder } = require('@discordjs/builders');
const logger = require('../../utils/logger');
const { noticePayload } = require('../../utils/ui');
const { fetchReportsForPlayer, fetchReportStats } = require('../../utils/reports_queries');
const { buildPlayerHistory, buildStatsCard } = require('../../utils/reports_view');
const { canActionReports, renderQueue } = require('../../handlers/reports');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reports')
        .setDescription('Work through the player report backlog.')
        .addSubcommand(sub =>
            sub.setName('queue')
                .setDescription('Step through reports, most urgent first.')
                .addStringOption(option =>
                    option.setName('status')
                        .setDescription('Which pile to work (defaults to open)')
                        .setRequired(false)
                        .addChoices(
                            { name: 'Open', value: 'open' },
                            { name: 'Awaiting reporter', value: 'needs_info' },
                        )))
        .addSubcommand(sub =>
            sub.setName('player')
                .setDescription('Every report ever filed against one player.')
                .addStringOption(option =>
                    option.setName('username')
                        .setDescription('The reported player\'s username')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('stats')
                .setDescription('Backlog digest: what is open, what is oldest, who is reported most.')),

    async execute(interaction) {
        try {
            await interaction.deferReply({ ephemeral: true });

            if (!canActionReports(interaction)) {
                await interaction.editReply(noticePayload(
                    'You do not have permission to review reports.',
                    { title: 'Permission Denied', subtitle: 'Player Reports' }
                ));
                return;
            }

            const subcommand = interaction.options.getSubcommand();

            if (subcommand === 'queue') {
                const filter = interaction.options.getString('status') || 'open';
                await interaction.editReply(await renderQueue(filter, 0));
                return;
            }

            if (subcommand === 'player') {
                const username = interaction.options.getString('username');
                const rows = await fetchReportsForPlayer(username);
                await interaction.editReply(buildPlayerHistory(username, rows));
                return;
            }

            await interaction.editReply(buildStatsCard(await fetchReportStats()));
        } catch (error) {
            logger.error('Error running /reports:', error);
            await interaction.editReply(noticePayload(
                'There was an error while loading reports. Please try again later.',
                { title: 'Reports Unavailable', subtitle: 'Player Reports' }
            )).catch(() => {});
        }
    },
};
