'use strict';

const { SlashCommandBuilder } = require('discord.js');
const logger = require('../../utils/logger');
const { noticePayload } = require('../../utils/ui');
const { deleteCdtDesign } = require('../../db');
const {
    SUBTITLE,
    rejectNonLead,
    fetchDesignThread,
    reconcileCdtTags,
    respondDesignAutocomplete,
    resolveDesignOption,
} = require('../../utils/cdt_designs');
const { deleteDesignFiles } = require('../../utils/cdt_storage');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('cdt-remove')
        .setDescription('Remove a published design: deletes its forum post, files, and stats (team leads)')
        .addStringOption((option) => option
            .setName('design')
            .setDescription('The design to remove')
            .setAutocomplete(true)
            .setRequired(true)),
    autocomplete: respondDesignAutocomplete,
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        if (await rejectNonLead(interaction)) {
            return;
        }

        try {
            const design = await resolveDesignOption(interaction);
            if (!design) {
                return;
            }

            const thread = await fetchDesignThread(interaction.client, design);
            if (thread) {
                try {
                    await thread.delete();
                } catch (error) {
                    // Keep the row so the lead can retry instead of orphaning
                    // a live forum post with a dead button.
                    logger.error('Failed to delete CDT forum thread:', error);
                    await interaction.editReply({
                        ...noticePayload(
                            'I could not delete the forum post, so nothing was removed. Please try again.',
                            { title: 'Removal Failed', subtitle: SUBTITLE }
                        ),
                        ephemeral: true,
                    });
                    return;
                }
            }
            await deleteDesignFiles(design.design_id)
                .catch((cleanupError) => logger.error('Failed to delete CDT design files from S3:', cleanupError));
            await deleteCdtDesign(design.design_id);
            await reconcileCdtTags(interaction.client);

            await interaction.editReply({
                ...noticePayload(
                    `Design #${design.design_id} **${design.title}** has been removed, along with its files and download stats.`,
                    { title: 'Design Removed', subtitle: SUBTITLE }
                ),
                ephemeral: true,
            });
        } catch (error) {
            logger.error('Error removing CDT design:', error);
            await interaction.editReply({
                ...noticePayload(
                    'There was an error removing the design. Please try again.',
                    { title: 'Removal Failed', subtitle: SUBTITLE }
                ),
                ephemeral: true,
            }).catch(() => {});
        }
    },
};
