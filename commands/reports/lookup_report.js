'use strict';

const { SlashCommandBuilder } = require('@discordjs/builders');
const { PermissionsBitField } = require('discord.js');
const logger = require('../../utils/logger');
const { noticePayload } = require('../../utils/ui');
const { REPORTS_FORUM_CHANNEL_ID } = require('../../config/constants');
const { fetchReportByRefId } = require('../../utils/reports_queries');
const { STATUS_LABEL, severityLabel, formatAge } = require('../../utils/reports_logic');

// Fallback for reports that predate indexing and have not been backfilled. Only
// reaches the newest 100 archived threads, which is exactly why the index exists.
const findThreadByRefId = async (guild, refId) => {
    const forumChannel = guild.channels.cache.get(REPORTS_FORUM_CHANNEL_ID);
    if (!forumChannel) {
        throw new Error('The forum channel for reports could not be found.');
    }

    const active = forumChannel.threads.cache.find(t => t.name.includes(refId));
    if (active) {
        return active;
    }

    try {
        const archived = await forumChannel.threads.fetchArchived({ limit: 100 });
        return archived.threads.find(t => t.name.includes(refId)) || null;
    } catch (fetchError) {
        logger.error('Error fetching archived threads:', fetchError.message);
        return null;
    }
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('lookup-report')
        .setDescription('Look up a player report by its reference ID.')
        .addStringOption(option =>
            option.setName('ref-id')
                .setDescription('The report reference ID (e.g., RPT-A1B2C3)')
                .setRequired(true)),

    async execute(interaction) {
        try {
            await interaction.deferReply({ ephemeral: true });

            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
                await interaction.editReply(noticePayload(
                    'You do not have permission to look up reports.',
                    { title: 'Permission Denied', subtitle: 'Report Lookup' }
                ));
                return;
            }

            const rawInput = interaction.options.getString('ref-id').trim().toUpperCase();
            const refId = rawInput.startsWith('RPT-') ? rawInput : `RPT-${rawInput}`;

            if (!/^RPT-[A-F0-9]{6}$/.test(refId)) {
                await interaction.editReply(noticePayload(
                    'Please provide a valid reference ID in the format RPT-XXXXXX (e.g., RPT-A1B2C3).',
                    { title: 'Invalid Reference ID', subtitle: 'Report Lookup' }
                ));
                return;
            }

            // The index answers with status and context; the thread scan only ever
            // answered with a link, so it is the fallback rather than the path.
            const report = await fetchReportByRefId(refId);
            if (report) {
                await interaction.editReply(noticePayload([
                    `**Reported Player:** ${report.reported_name}`,
                    `**Status:** ${STATUS_LABEL[report.status] || report.status}`,
                    `**Severity:** ${severityLabel(report.severity)}`,
                    `**Filed:** ${formatAge(report.created_at)} ago`,
                    report.actioned_by ? `**Actioned by:** <@${report.actioned_by}>` : null,
                    report.rule_broken ? `**Rule broken:** ${report.rule_broken}` : null,
                    report.proof_description ? `**Proof shows:** ${report.proof_description}` : null,
                    report.proof_url ? `**Proof link:** ${report.proof_url}` : null,
                    report.thread_url ? `**Thread:** ${report.thread_url}` : null,
                ], { title: 'Report Found', subtitle: refId }));
                return;
            }

            const match = await findThreadByRefId(interaction.guild, refId);
            if (!match) {
                await interaction.editReply(noticePayload(
                    `No report found with reference ID **${refId}**.`,
                    { title: 'Report Not Found', subtitle: refId }
                ));
                return;
            }

            await interaction.editReply(noticePayload([
                `**Thread:** ${match.name}`,
                `**Link:** ${match.url}`,
                '',
                '_This report is not indexed yet. Run `/reports backfill` to include it in the queue._',
            ], { title: 'Report Found', subtitle: refId }));
        } catch (error) {
            logger.error('Error looking up report:', error);
            await interaction.editReply(noticePayload(
                'There was an error while looking up the report. Please try again later.',
                { title: 'Lookup Failed', subtitle: 'Report Lookup' }
            )).catch(() => {});
        }
    },
};
