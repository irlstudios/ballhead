'use strict';

const { SlashCommandBuilder } = require('@discordjs/builders');
const logger = require('../../utils/logger');
const { noticePayload } = require('../../utils/ui');
const { BOT_ADMIN_USER_ID } = require('../../config/constants');
const { fetchReportsForPlayer, fetchReportStats } = require('../../utils/reports_queries');
const { buildPlayerHistory, buildStatsCard } = require('../../utils/reports_view');
const { backfillReports } = require('../../utils/reports_backfill');
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
                .setDescription('Backlog digest: what is open, what is oldest, who is reported most.'))
        .addSubcommand(sub =>
            sub.setName('backfill')
                .setDescription('Admin: index existing report threads that predate report tracking.')),

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

            // ponytail: one-time import exposed as a command only because it has to
            // run more than once (200-thread cap) and the database is reachable only
            // from the bot host. Delete this subcommand, and backfillReports with it,
            // once the reports forum is fully indexed.
            if (subcommand === 'backfill') {
                // Locked to one account rather than the Administrator permission: this
                // writes several hundred rows and should not be reachable by every
                // moderator who happens to hold admin.
                if (interaction.user.id !== BOT_ADMIN_USER_ID) {
                    await interaction.editReply(noticePayload(
                        'The backfill is restricted to the bot administrator.',
                        { title: 'Permission Denied', subtitle: 'Player Reports' }
                    ));
                    return;
                }
                const result = await backfillReports(interaction.guild);
                await interaction.editReply(noticePayload([
                    `**Threads scanned:** ${result.scanned}`,
                    `**Newly indexed:** ${result.inserted}`,
                    `**Already indexed:** ${result.existing}`,
                    `**Skipped:** ${result.skipped}`,
                    '',
                    result.skipped > 0
                        ? '_Skipped threads had an unreadable name or a deleted starter message._'
                        : null,
                    'Safe to run again; it only picks up what it missed.',
                ], { title: 'Backfill Complete', subtitle: 'Player Reports' }));
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
