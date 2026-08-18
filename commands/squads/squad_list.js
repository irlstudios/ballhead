'use strict';

const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const squadDb = require('../../utils/squad_db');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('squad-list')
        .setDescription('Lists all registered squads and their owners.'),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        async function getSquadList() {
            const rows = await squadDb.fetchAllSquadsWithCounts();
            return rows.map((s) =>
                `- **${s.name}** (${s.squad_type}) - ${s.member_count + 1}/${squadDb.MAX_SQUAD_MEMBERS} members (Owner: <@${s.owner_id}>)`
            );
        }

        try {
            const squadList = await getSquadList();
            logger.info(`[Squads] Interaction ${interaction.id}: fetched squadList with ${squadList.length} items`);

            if (squadList.length === 0) {
                const emptyContainer = new ContainerBuilder();
                emptyContainer.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('## Registered Squads'),
                    new TextDisplayBuilder().setContent('No squads found in the registry.')
                );
                await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [emptyContainer], ephemeral: true });
                return;
            }

            const ITEMS_PER_PAGE = 10;
            const totalPages = Math.ceil(squadList.length / ITEMS_PER_PAGE);
            logger.info(`[Squads] ITEMS_PER_PAGE=${ITEMS_PER_PAGE}, totalPages=${totalPages}`);
            let currentPage = 1;
            const generateContainer = (page) => {
                const start = (page - 1) * ITEMS_PER_PAGE;
                const end = start + ITEMS_PER_PAGE;
                const pageItems = squadList.slice(start, Math.min(end, squadList.length));

                const container = new ContainerBuilder();
                container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('## Registered Squads'),
                    new TextDisplayBuilder().setContent(pageItems.length > 0 ? pageItems.join('\n') : 'No squads on this page.'),
                    new TextDisplayBuilder().setContent(`-# Page ${page} of ${totalPages}`)
                );
                return container;
            };

            const generateButtons = (page) => {
                return new ActionRowBuilder()
                    .addComponents(
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

            if (!interaction.client.squadsPagination) interaction.client.squadsPagination = new Map();
            interaction.client.squadsPagination.set(interaction.id, { squadList, totalPages, currentPage });

            // Clean up pagination data after 15 minutes to prevent memory leak
            setTimeout(() => {
                interaction.client.squadsPagination.delete(interaction.id);
            }, 900000);

            await interaction.editReply({
                flags: MessageFlags.IsComponentsV2,
                components: [generateContainer(currentPage), generateButtons(currentPage)],
                ephemeral: true
            });

        } catch (error) {
            logger.error('Error executing /squad list command:', error);

            const errorContainer = new ContainerBuilder();
            errorContainer.addTextDisplayComponents(
                new TextDisplayBuilder().setContent('## Request Failed'),
                new TextDisplayBuilder().setContent(`An error occurred: ${error.message || 'Please try again later.'}`)
            );
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer], ephemeral: true });
        }
    }
};
