'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ContainerBuilder } = require('discord.js');
const logger = require('../utils/logger');
const { buildTextBlock, noticePayload } = require('../utils/ui');
const { GYM_CLASS_GUILD_ID, BOT_BUGS_CHANNEL_ID, ITEMS_PER_PAGE } = require('../config/constants');

const handlePagination1 = async (interaction, customId) => {
    try {
        await interaction.deferUpdate();

        const resolvedCustomId = customId ?? interaction.customId;
        const originalInteractionId = interaction.message.interaction?.id;

        if (!originalInteractionId) {
            logger.error('Could not retrieve original interaction ID from message.');
            return;
        }

        const commandState = interaction.client.squadsPagination.get(originalInteractionId);

        if (!commandState) {
            logger.error(`No commandData found for original interaction ID: ${originalInteractionId}`);
            await interaction.editReply(
                noticePayload(
                    'Sorry, I can\'t find the data for this list anymore. Please run the command again.',
                    { title: 'Pagination Expired', subtitle: 'Squad List' }
                )
            );
            return;
        }

        const { squadList, totalPages, currentPage } = commandState;
        let newPage = currentPage;

        if (resolvedCustomId === 'squads_next') {
            newPage = currentPage + 1;
        } else if (resolvedCustomId === 'squads_prev') {
            newPage = currentPage - 1;
        } else {
            logger.warn(`Received unexpected customId in handlePagination1: ${resolvedCustomId}`);
            return;
        }

        if (newPage < 1 || newPage > totalPages) {
            logger.warn(`Pagination attempt outside bounds: newPage=${newPage}, totalPages=${totalPages}`);
            return;
        }

        const updatedState = { ...commandState, currentPage: newPage };
        interaction.client.squadsPagination.set(originalInteractionId, updatedState);

        const generateContainer = (page) => {
            const start = (page - 1) * ITEMS_PER_PAGE;
            const end = start + ITEMS_PER_PAGE;
            const pageItems = squadList.slice(start, Math.min(end, squadList.length));
            const container = new ContainerBuilder();
            const block = buildTextBlock({
                title: 'Squad Registry',
                subtitle: 'All registered squads',
                lines: [pageItems.length > 0 ? pageItems.join('\n') : 'No squads on this page.'],
            });
            if (block) container.addTextDisplayComponents(block);
            return container;
        };

        const generateButtons = (page) => {
            return new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('squads_prev')
                    .setLabel('Previous')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(page === 1),
                new ButtonBuilder()
                    .setCustomId('squads_next')
                    .setLabel('Next')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(page === totalPages)
            );
        };

        await interaction.editReply({
            flags: MessageFlags.IsComponentsV2,
            components: [generateContainer(newPage), generateButtons(newPage)],
        });
    } catch (error) {
        logger.error('Error handling pagination:', error);

        try {
            const errorGuild = await interaction.client.guilds.fetch(GYM_CLASS_GUILD_ID).catch(() => null);
            if (errorGuild) {
                const errorChannel = await errorGuild.channels.fetch(BOT_BUGS_CHANNEL_ID).catch(() => null);
                if (errorChannel) {
                    const paginationErrorContainer = new ContainerBuilder();
                    const block = buildTextBlock({
                        title: 'Pagination Error',
                        subtitle: 'Squad registry navigation failed',
                        lines: [
                            `**Error:** ${error.message}`,
                            `**Interaction Custom ID:** ${interaction.customId}`,
                            `**Original Command ID:** ${interaction.message.interaction?.id}`,
                        ],
                    });
                    if (block) paginationErrorContainer.addTextDisplayComponents(block);
                    await errorChannel.send({ flags: MessageFlags.IsComponentsV2, components: [paginationErrorContainer] });
                }
            }
        } catch (logError) {
            logger.error('Failed to log pagination error:', logError);
        }

        try {
            await interaction.followUp({
                ...noticePayload('An error occurred while changing pages. Please try running the command again.', { title: 'Pagination Error', subtitle: 'Squad List' }),
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            });
        } catch (followUpError) {
            logger.error('Failed to send follow-up error message:', followUpError);
        }
    }
};

module.exports = {
    handlePagination1,
};
