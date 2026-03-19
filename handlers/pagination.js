'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ContainerBuilder } = require('discord.js');
const logger = require('../utils/logger');
const { buildTextBlock, parseWeek, noticePayload } = require('../utils/ui');
const { BALLHEAD_GUILD_ID, BOT_BUGS_CHANNEL_ID, ITEMS_PER_PAGE } = require('../config/constants');

const buildQualityScorePage = (paginationData, page) => {
    const { posts, totalPages, username, runningAverage, weeklyAverages, embedColor, platform, seasonStart } = paginationData;
    const colorHex = typeof embedColor === 'string' ? parseInt(embedColor.replace('#', ''), 16) : (embedColor || 0x0099ff);

    let container;
    if (page === 1) {
        const weeklyFields = Object.entries(weeklyAverages)
            .sort((a, b) => {
                const weekA = parseWeek(a[0]);
                const weekB = parseWeek(b[0]);
                if (weekA === null && weekB === null) return 0;
                if (weekA === null) return 1;
                if (weekB === null) return -1;
                return weekA - weekB;
            })
            .slice(0, 20)
            .map(([week, score]) => {
                const parsedWeek = parseWeek(week);
                const label = parsedWeek === null ? week : parsedWeek;
                return `**Week ${label}:** ${score}`;
            });

        container = new ContainerBuilder().setAccentColor(colorHex);
        const summaryLines = [
            `**Running Average (Season):** ${runningAverage}`,
            `**Total Posts:** ${posts.length}`,
            `**Season Start:** ${(seasonStart && seasonStart.display) ? seasonStart.display : 'N/A'}`,
        ];
        if (platform) summaryLines.push(`**Platform:** ${platform}`);
        const weeklyLines = weeklyFields.length > 0
            ? weeklyFields
            : ['**Weekly Averages:** No weekly data available.'];
        const block = buildTextBlock({
            title: `${username}'s Quality Scores`,
            subtitle: platform ? `${platform} overview` : 'Season overview',
            lines: [...summaryLines, '', ...weeklyLines],
        });
        if (block) container.addTextDisplayComponents(block);
    } else {
        const postIndex = page - 2;
        const post = posts[postIndex];
        if (!post) {
            throw new Error('Post data not found for the current page.');
        }

        container = new ContainerBuilder().setAccentColor(colorHex);
        const block = buildTextBlock({
            title: `${username}'s Quality Score`,
            subtitle: `Post ${page - 1} of ${totalPages - 1}`,
            lines: [
                `**Score:** ${post.score}`,
                `**Likes:** ${post.likes}`,
                `**Points:** ${post.points ? post.points : 'N/A'}`,
                `**Views:** ${post.views}`,
                `**Season Week:** ${post.week !== null ? `Week ${post.week}` : 'N/A'}`,
                `**Platform:** ${post.platform || platform || 'N/A'}`,
                `**Post Date:** ${post.postDateDisplay || 'N/A'}`,
                `**URL:** ${post.url}`,
                `**Details:** ${post.details}`,
            ],
        });
        if (block) container.addTextDisplayComponents(block);
    }

    return container;
};

const buildQualityScoreButtons = (currentPage, totalPages) => {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('prev2')
            .setLabel('Previous')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(currentPage === 1),
        new ButtonBuilder()
            .setCustomId('next2')
            .setLabel('Next')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(currentPage === totalPages)
    );
};

const handleQualityScorePagination = async (interaction, direction) => {
    try {
        await interaction.deferUpdate();

        const messageId = interaction.message.id;
        const paginationData = interaction.client.commandData.get(messageId);

        if (!paginationData) {
            logger.error(`No pagination data found for message ID: ${messageId}`);
            return await interaction.followUp({
                ...noticePayload('Pagination data not found or has expired.', { title: 'Pagination Expired', subtitle: 'Quality Scores' }),
                ephemeral: true,
            });
        }

        const { totalPages } = paginationData;
        let newPage = paginationData.currentPage + direction;
        newPage = Math.max(1, Math.min(newPage, totalPages));

        const updatedData = { ...paginationData, currentPage: newPage };
        interaction.client.commandData.set(messageId, updatedData);

        const container = buildQualityScorePage(updatedData, newPage);
        const actionRow = buildQualityScoreButtons(newPage, totalPages);

        await interaction.editReply({
            flags: MessageFlags.IsComponentsV2,
            components: [container, actionRow],
        });
    } catch (error) {
        logger.error(`Error handling ${direction > 0 ? 'Next' : 'Previous'} pagination:`, error.message);
    }
};

const handleNext2 = (interaction) => handleQualityScorePagination(interaction, 1);
const handlePrev2 = (interaction) => handleQualityScorePagination(interaction, -1);

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
            const errorGuild = await interaction.client.guilds.fetch(BALLHEAD_GUILD_ID).catch(() => null);
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
                ephemeral: true,
            });
        } catch (followUpError) {
            logger.error('Failed to send follow-up error message:', followUpError);
        }
    }
};

module.exports = {
    handleNext2,
    handlePrev2,
    handlePagination1,
};
