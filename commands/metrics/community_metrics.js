'use strict';

const { SlashCommandBuilder } = require('@discordjs/builders');
const { PermissionsBitField } = require('discord.js');
const moment = require('moment-timezone');
const logger = require('../../utils/logger');
const { noticePayload } = require('../../utils/ui');
const { runCommunityMetrics, TIMEZONE } = require('../../jobs/community-metrics');

const DATE_FORMAT = 'YYYY-MM-DD';

const parseDate = (raw, edge) => {
    const m = moment.tz(raw.trim(), DATE_FORMAT, true, TIMEZONE);
    if (!m.isValid()) {
        return null;
    }
    return edge === 'end' ? m.endOf('day') : m.startOf('day');
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('community-metrics')
        .setDescription('Game-ideas and bug-report metrics for a date range (staff only).')
        .addStringOption(option =>
            option.setName('start-date')
                .setDescription('Start date (YYYY-MM-DD), interpreted in US Central time')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('end-date')
                .setDescription('End date (YYYY-MM-DD), inclusive, US Central time')
                .setRequired(true))
        .addBooleanOption(option =>
            option.setName('append-to-sheet')
                .setDescription('Also append these stats to the community metrics Google Sheet')
                .setRequired(false)),

    async execute(interaction) {
        try {
            await interaction.deferReply({ ephemeral: true });

            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
                await interaction.editReply(
                    noticePayload('You do not have permission to view community metrics.', { title: 'Permission Denied', subtitle: 'Community Metrics' }),
                );
                return;
            }

            const start = parseDate(interaction.options.getString('start-date'), 'start');
            const end = parseDate(interaction.options.getString('end-date'), 'end');

            if (!start || !end) {
                await interaction.editReply(
                    noticePayload(`Please provide valid dates in ${DATE_FORMAT} format (e.g., 2026-05-29).`, { title: 'Invalid Date', subtitle: 'Community Metrics' }),
                );
                return;
            }

            if (start.isAfter(end)) {
                await interaction.editReply(
                    noticePayload('The start date must be on or before the end date.', { title: 'Invalid Range', subtitle: 'Community Metrics' }),
                );
                return;
            }

            const appendSheet = interaction.options.getBoolean('append-to-sheet') || false;

            const metrics = await runCommunityMetrics(interaction.client, {
                start: start.toDate(),
                end: end.toDate(),
                appendSheet,
            });

            const lines = [
                `**Range:** ${start.format(DATE_FORMAT)} to ${end.format(DATE_FORMAT)} (US Central)`,
                '',
                '**Game Ideas** (within range)',
                `- Posts/threads: ${metrics.gameIdeas.threadCount}`,
                `- Unique participants: ${metrics.gameIdeas.uniqueParticipants}`,
                `- Total messages: ${metrics.gameIdeas.messageCount}`,
                '',
                '**Bug Reports** (open = currently active, not closed)',
                `- Open issues created in range: ${metrics.bugReports.openInRange}`,
                `- Total open now: ${metrics.bugReports.totalOpen}`,
                `- Open & escalated: ${metrics.bugReports.openEscalated}`,
                `- Open & un-escalated: ${metrics.bugReports.openUnescalated}`,
            ];

            if (metrics.gameIdeas.unavailable) {
                lines.push('', '_Game-ideas data could not be read; counts shown as 0._');
            }

            if (metrics.bugReports.unavailable) {
                lines.push('', '_Bug report forum could not be read; counts shown as 0._');
            }

            if (appendSheet) {
                lines.push('', metrics.appended
                    ? 'Appended to the community metrics Google Sheet.'
                    : `Could not append to the sheet: ${metrics.appendError || 'unknown error'}.`);
            }

            await interaction.editReply(
                noticePayload(lines, { title: 'Community Metrics', subtitle: 'Game Ideas & Bug Reports' }),
            );
        } catch (error) {
            logger.error('Error running community metrics command:', error);
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply(
                    noticePayload('There was an error generating the metrics. Please try again later.', { title: 'Metrics Failed', subtitle: 'Community Metrics' }),
                ).catch(() => {});
            }
        }
    },
};
