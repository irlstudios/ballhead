'use strict';

const { SlashCommandBuilder } = require('discord.js');
const logger = require('../../utils/logger');
const { noticePayload } = require('../../utils/ui');
const { ensureCdtDesignTables, insertCdtDesign, updateCdtDesign, deleteCdtDesign } = require('../../db');
const {
    SUBTITLE,
    CATEGORY_CHOICES,
    rejectNonLead,
    fetchLinkedMessage,
    toPreviewPayloads,
    resolveFilesInput,
    buildDesignPostPayload,
    fetchDesignsForum,
} = require('../../utils/cdt_designs');
const { putDesignFiles, deleteDesignFiles } = require('../../utils/cdt_storage');
const { CDT_FORUM_TAGS } = require('../../config/constants');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('cdt-approve')
        .setDescription('Approve a design submission and publish it to the designs forum (team leads)')
        .addStringOption((option) => option
            .setName('submission')
            .setDescription('Message link with the in-game preview images shown on the public post')
            .setRequired(true))
        .addStringOption((option) => option
            .setName('files')
            .setDescription('Message link or attachment link(s) with the design files. Never shown on the post')
            .setRequired(true))
        .addStringOption((option) => option
            .setName('title')
            .setDescription('Design title, used as the forum post name')
            .setMaxLength(90)
            .setRequired(true))
        .addStringOption((option) => option
            .setName('category')
            .setDescription('What kind of design this is')
            .addChoices(...CATEGORY_CHOICES)
            .setRequired(true))
        .addStringOption((option) => option
            .setName('description')
            .setDescription('Text shown on the public post')
            .setMaxLength(1500)
            .setRequired(true))
        .addUserOption((option) => option
            .setName('designer')
            .setDescription('Who gets credit (defaults to the author of the submission message)'))
        .addStringOption((option) => option
            .setName('credit')
            .setDescription('Credit name shown on the post (defaults to the designer\'s display name)')
            .setMaxLength(60)),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        if (await rejectNonLead(interaction)) {
            return;
        }

        try {
            await ensureCdtDesignTables();

            const { message, error } = await fetchLinkedMessage(interaction, interaction.options.getString('submission'));
            if (error) {
                await interaction.editReply({
                    ...noticePayload(error, { title: 'Bad Submission Link', subtitle: SUBTITLE }),
                    ephemeral: true,
                });
                return;
            }

            // Strict split: the submission link only supplies preview images,
            // the files input only supplies the downloadables. Court files are
            // images too, so any attachment used as a file is excluded from
            // the public gallery.
            const filesResult = await resolveFilesInput(interaction, interaction.options.getString('files'));
            if (filesResult.error) {
                await interaction.editReply({
                    ...noticePayload(filesResult.error, { title: 'Bad Files Link', subtitle: SUBTITLE }),
                    ephemeral: true,
                });
                return;
            }
            if (filesResult.messageId === message.id) {
                await interaction.editReply({
                    ...noticePayload(
                        'The files link points at the whole submission message, which would publish the design file as a preview. Right click the design file itself and use Copy Link instead, or link a separate message.',
                        { title: 'Separate The Files', subtitle: SUBTITLE }
                    ),
                    ephemeral: true,
                });
                return;
            }

            const previews = toPreviewPayloads(message, filesResult.attachmentIds);
            if (previews.length === 0) {
                await interaction.editReply({
                    ...noticePayload(
                        'The submission message has no image attachments to use as previews (attachments used as design files are excluded).',
                        { title: 'No Previews Found', subtitle: SUBTITLE }
                    ),
                    ephemeral: true,
                });
                return;
            }

            const forum = await fetchDesignsForum(interaction.client);
            if (!forum) {
                await interaction.editReply({
                    ...noticePayload(
                        'The designs forum channel is not configured or not reachable.',
                        { title: 'Forum Unavailable', subtitle: SUBTITLE }
                    ),
                    ephemeral: true,
                });
                return;
            }

            const title = interaction.options.getString('title');
            const category = interaction.options.getString('category');
            const description = interaction.options.getString('description');
            const designer = interaction.options.getUser('designer') || message.author;
            const creditName = interaction.options.getString('credit') || designer.displayName;

            const designId = await insertCdtDesign({
                title,
                category,
                description,
                designerId: designer.id,
                creditName,
                approvedBy: interaction.user.id,
            });

            try {
                await putDesignFiles(designId, 1, filesResult.files);
            } catch (uploadError) {
                await deleteDesignFiles(designId).catch(() => {});
                await deleteCdtDesign(designId).catch(() => {});
                throw uploadError;
            }

            let thread;
            try {
                thread = await forum.threads.create({
                    name: title.slice(0, 100),
                    appliedTags: CDT_FORUM_TAGS[category] ? [CDT_FORUM_TAGS[category]] : [],
                    message: {
                        ...buildDesignPostPayload({
                            designId,
                            title,
                            category,
                            description,
                            designerId: designer.id,
                            creditName,
                            previewNames: previews.map((p) => p.name),
                        }),
                        files: previews,
                    },
                });
                await updateCdtDesign(designId, { forumThreadId: thread.id });
            } catch (postError) {
                // Kill the public post first: a live post with a dead button is
                // worse than any leftover row or S3 object.
                if (thread) await thread.delete().catch(() => {});
                await deleteCdtDesign(designId).catch(() => {});
                await deleteDesignFiles(designId).catch(() => {});
                throw postError;
            }

            await interaction.editReply({
                ...noticePayload(
                    [
                        `Design #${designId} **${title}** by ${creditName} has been published.`,
                        thread.url,
                    ],
                    { title: 'Design Published', subtitle: SUBTITLE }
                ),
                ephemeral: true,
            });
        } catch (error) {
            logger.error('Error approving CDT design:', error);
            await interaction.editReply({
                ...noticePayload(
                    [
                        'There was an error publishing the design. Nothing was published.',
                        `Reason: ${error.message || 'unknown'}`,
                    ],
                    { title: 'Publish Failed', subtitle: SUBTITLE }
                ),
                ephemeral: true,
            }).catch(() => {});
        }
    },
};
