'use strict';

const { SlashCommandBuilder } = require('discord.js');
const logger = require('../../utils/logger');
const { noticePayload } = require('../../utils/ui');
const { ensureCdtDesignTables, cdtDownloadStats } = require('../../db');
const { SUBTITLE, rejectNonLead } = require('../../utils/cdt_designs');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('cdt-stats')
        .setDescription('Show unique downloads per published design (team leads)'),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        if (await rejectNonLead(interaction)) {
            return;
        }

        try {
            await ensureCdtDesignTables();
            const rows = await cdtDownloadStats();

            const lines = rows.length === 0
                ? ['No designs have been published yet.']
                : rows.map((row) =>
                    `**#${row.design_id} ${row.title.slice(0, 40)}** (${row.category}) by ${row.credit_name.slice(0, 20)} - ` +
                    `${row.downloads} unique ${row.downloads === 1 ? 'download' : 'downloads'}`
                );

            await interaction.editReply({
                ...noticePayload(lines, { title: 'Design Downloads (Top 20)', subtitle: SUBTITLE }),
                ephemeral: true,
            });
        } catch (error) {
            logger.error('Error fetching CDT stats:', error);
            await interaction.editReply({
                ...noticePayload(
                    'There was an error fetching download stats. Please try again.',
                    { title: 'Stats Failed', subtitle: SUBTITLE }
                ),
                ephemeral: true,
            }).catch(() => {});
        }
    },
};
