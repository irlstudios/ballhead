'use strict';

const { SlashCommandBuilder } = require('discord.js');
const logger = require('../../utils/logger');
const { noticePayload } = require('../../utils/ui');
const { updateCdtDesign, commitCdtFileVersion } = require('../../db');
const {
    SUBTITLE,
    rejectNonLead,
    fetchLinkedMessage,
    toFilePayloads,
    toPreviewPayloads,
    buildDesignPostPayload,
    fetchDesignThread,
    respondDesignAutocomplete,
    resolveDesignOption,
} = require('../../utils/cdt_designs');
const { putDesignFiles, deleteDesignFiles } = require('../../utils/cdt_storage');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('cdt-update')
        .setDescription('Update a published design\'s info or files (team leads)')
        .addStringOption((option) => option
            .setName('design')
            .setDescription('The design to update')
            .setAutocomplete(true)
            .setRequired(true))
        .addStringOption((option) => option
            .setName('title')
            .setDescription('New title')
            .setMaxLength(90))
        .addStringOption((option) => option
            .setName('description')
            .setDescription('New text for the public post')
            .setMaxLength(1500))
        .addStringOption((option) => option
            .setName('credit')
            .setDescription('New credit name')
            .setMaxLength(60))
        .addStringOption((option) => option
            .setName('files')
            .setDescription('Message link with the new files (replaces all served files, previews stay)')),
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

            const title = interaction.options.getString('title');
            const description = interaction.options.getString('description');
            const credit = interaction.options.getString('credit');
            const filesLink = interaction.options.getString('files');

            if (!title && !description && !credit && !filesLink) {
                await interaction.editReply({
                    ...noticePayload(
                        'Provide at least one of: title, description, credit, or files.',
                        { title: 'Nothing To Update', subtitle: SUBTITLE }
                    ),
                    ephemeral: true,
                });
                return;
            }

            const changed = [];

            if (filesLink) {
                const { message, error } = await fetchLinkedMessage(interaction, filesLink);
                if (error) {
                    await interaction.editReply({
                        ...noticePayload(error, { title: 'Bad Files Link', subtitle: SUBTITLE }),
                        ephemeral: true,
                    });
                    return;
                }
                const newVersion = design.file_version + 1;
                try {
                    await putDesignFiles(design.design_id, newVersion, toFilePayloads(message));
                } catch (uploadError) {
                    await deleteDesignFiles(design.design_id, newVersion).catch(() => {});
                    throw uploadError;
                }
                const committed = await commitCdtFileVersion(design.design_id, design.file_version, newVersion);
                if (!committed) {
                    await deleteDesignFiles(design.design_id, newVersion).catch(() => {});
                    await interaction.editReply({
                        ...noticePayload(
                            'Someone else updated this design\'s files at the same time. Re-run the command to apply yours.',
                            { title: 'Update Conflict', subtitle: SUBTITLE }
                        ),
                        ephemeral: true,
                    });
                    return;
                }
                await deleteDesignFiles(design.design_id, design.file_version)
                    .catch((cleanupError) => logger.error('Failed to delete old CDT design files:', cleanupError.message));
                changed.push('files');
            }

            let postUpdated = true;
            if (title || description || credit) {
                // Edit the public post first so the database never claims text
                // the forum does not show.
                const thread = await fetchDesignThread(interaction.client, design);
                if (thread) {
                    const starter = await thread.fetchStarterMessage();
                    const previews = toPreviewPayloads(starter);
                    await starter.edit({
                        ...buildDesignPostPayload({
                            designId: design.design_id,
                            title: title || design.title,
                            category: design.category,
                            description: description || design.description,
                            designerId: design.designer_id,
                            creditName: credit || design.credit_name,
                            previewNames: previews.map((p) => p.name),
                        }),
                        files: previews,
                        attachments: [],
                    });
                    if (title && thread.name !== title) {
                        await thread.setName(title.slice(0, 100));
                    }
                } else {
                    postUpdated = false;
                }
                await updateCdtDesign(design.design_id, {
                    title: title ?? undefined,
                    description: description ?? undefined,
                    creditName: credit ?? undefined,
                });
                if (title) changed.push('title');
                if (description) changed.push('description');
                if (credit) changed.push('credit');
            }

            await interaction.editReply({
                ...noticePayload(
                    [
                        `Design #${design.design_id} updated: ${changed.join(', ')}.`,
                        postUpdated ? null : 'Warning: the forum post could not be found, so it was not edited.',
                    ],
                    { title: 'Design Updated', subtitle: SUBTITLE }
                ),
                ephemeral: true,
            });
        } catch (error) {
            logger.error('Error updating CDT design:', error);
            await interaction.editReply({
                ...noticePayload(
                    'There was an error updating the design. Please try again.',
                    { title: 'Update Failed', subtitle: SUBTITLE }
                ),
                ephemeral: true,
            }).catch(() => {});
        }
    },
};
