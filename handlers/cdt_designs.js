'use strict';

const { ContainerBuilder, FileBuilder, MessageFlags } = require('discord.js');
const logger = require('../utils/logger');
const { buildTextBlock, noticePayload } = require('../utils/ui');
const { getCdtDesign, recordCdtDownload } = require('../db');
const { SUBTITLE, CC_LINE, reconcileCdtTags } = require('../utils/cdt_designs');
const { getDesignFiles } = require('../utils/cdt_storage');

// Serves a design's files ephemerally from S3 and records one download per
// unique user per design. Files are read from the design's current version
// prefix, so lead file swaps take effect instantly.
const handleCdtDownloadButton = async (interaction) => {
    try {
        await interaction.deferReply({ ephemeral: true });

        const designId = Number.parseInt(interaction.customId.split('_')[1], 10);
        const design = Number.isInteger(designId) ? await getCdtDesign(designId) : null;
        if (!design) {
            await interaction.editReply({
                ...noticePayload(
                    'This design is no longer available.',
                    { title: 'Design Unavailable', subtitle: SUBTITLE }
                ),
                ephemeral: true,
            });
            return;
        }

        let files = [];
        try {
            files = await getDesignFiles(design.design_id, design.file_version);
        } catch (error) {
            logger.error(`Failed to fetch CDT design files from S3 for design ${design.design_id}:`, error);
        }
        if (files.length === 0) {
            await interaction.editReply({
                ...noticePayload(
                    'The files for this design could not be found. Please let a team lead know.',
                    { title: 'Files Missing', subtitle: SUBTITLE }
                ),
                ephemeral: true,
            });
            return;
        }

        // File components render as raw downloadable attachments instead of
        // inline image previews.
        const container = new ContainerBuilder();
        const block = buildTextBlock({
            title: design.title,
            subtitle: `by ${design.credit_name}`,
            lines: [CC_LINE],
        });
        if (block) container.addTextDisplayComponents(block);
        for (const file of files) {
            container.addFileComponents(new FileBuilder().setURL(`attachment://${file.name}`));
        }
        await interaction.editReply({
            flags: MessageFlags.IsComponentsV2,
            components: [container],
            files,
        });

        await recordCdtDownload(design.design_id, interaction.user.id);
        await reconcileCdtTags(interaction.client);
    } catch (error) {
        logger.error('Error serving CDT design files:', error);
        if (interaction.deferred && !interaction.replied) {
            await interaction.editReply({
                ...noticePayload(
                    'There was an error fetching the files. Please try again.',
                    { title: 'Download Failed', subtitle: SUBTITLE }
                ),
                ephemeral: true,
            }).catch(() => {});
        }
    }
};

module.exports = {
    handleCdtDownloadButton,
};
