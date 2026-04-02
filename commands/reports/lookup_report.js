'use strict';

const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageFlags, ContainerBuilder, TextDisplayBuilder, PermissionsBitField } = require('discord.js');
const logger = require('../../utils/logger');

const REPORTS_FORUM_CHANNEL_ID = '1139975178013655183';

function buildTextBlock({ title, subtitle, lines } = {}) {
    const parts = [];
    if (title) parts.push(`## ${title}`);
    if (subtitle) parts.push(subtitle);
    if (Array.isArray(lines) && lines.length > 0) {
        if (parts.length > 0) parts.push('');
        parts.push(...lines.filter(Boolean));
    }
    if (parts.length === 0) return null;
    return new TextDisplayBuilder().setContent(parts.join('\n'));
}

function buildNoticeContainer({ title, subtitle, lines }) {
    const container = new ContainerBuilder();
    const block = buildTextBlock({ title, subtitle, lines });
    if (block) container.addTextDisplayComponents(block);
    return container;
}

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
                const denied = buildNoticeContainer({
                    title: 'Permission Denied',
                    subtitle: 'Report Lookup',
                    lines: ['You do not have permission to look up reports.'],
                });
                await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [denied] });
                return;
            }

            const rawInput = interaction.options.getString('ref-id').trim().toUpperCase();
            const refId = rawInput.startsWith('RPT-') ? rawInput : `RPT-${rawInput}`;

            if (!/^RPT-[A-F0-9]{6}$/.test(refId)) {
                const invalid = buildNoticeContainer({
                    title: 'Invalid Reference ID',
                    subtitle: 'Report Lookup',
                    lines: ['Please provide a valid reference ID in the format RPT-XXXXXX (e.g., RPT-A1B2C3).'],
                });
                await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [invalid] });
                return;
            }

            const forumChannel = interaction.guild.channels.cache.get(REPORTS_FORUM_CHANNEL_ID);
            if (!forumChannel) {
                throw new Error('The forum channel for reports could not be found.');
            }

            const activeThreads = forumChannel.threads.cache.filter(t => t.name.includes(refId));

            let match = activeThreads.first();

            if (!match) {
                try {
                    const archived = await forumChannel.threads.fetchArchived({ limit: 100 });
                    match = archived.threads.find(t => t.name.includes(refId));
                } catch (fetchError) {
                    logger.error('Error fetching archived threads:', fetchError.message);
                }
            }

            if (!match) {
                const notFound = buildNoticeContainer({
                    title: 'Report Not Found',
                    subtitle: refId,
                    lines: [`No report found with reference ID **${refId}**.`],
                });
                await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [notFound] });
                return;
            }

            const found = buildNoticeContainer({
                title: 'Report Found',
                subtitle: refId,
                lines: [
                    `**Thread:** ${match.name}`,
                    `**Link:** ${match.url}`,
                ],
            });
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [found] });
        } catch (error) {
            logger.error('Error looking up report:', error);
            const errorContainer = buildNoticeContainer({
                title: 'Lookup Failed',
                subtitle: 'Report Lookup',
                lines: ['There was an error while looking up the report. Please try again later.'],
            });
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer] });
        }
    },
};
