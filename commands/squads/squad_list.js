const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getSheetsClient } = require('../../utils/sheets_cache');

const SPREADSHEET_ID = '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('squads')
        .setDescription('Lists all registered squads and their owners.'),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const sheets = await getSheetsClient();

        async function getSquadList() {
            const range = '\'Squad Leaders\'!A:F';
            try {
                const response = await sheets.spreadsheets.values.get({
                    spreadsheetId: SPREADSHEET_ID,
                    range,
                });
                const rows = response.data.values || [];

                const dataRows = rows.slice(1);

                if (dataRows.length > 0) {
                    return dataRows
                        .filter(row => row && row.length > 2 && row[1] && row[2])
                        .map(row => {
                            const squadName = row[2].trim();
                            const ownerId = row[1].trim();
                            return `- **${squadName}** (Owner: <@${ownerId}>)`;
                        });
                } else {
                    return [];
                }
            } catch (error) {
                console.error('The API returned an error while fetching squad leaders:', error);
                throw new Error('Failed to fetch squad list from the sheet.');
            }
        }

        try {
            const squadList = await getSquadList();
            console.log(`[Squads] Interaction ${interaction.id}: fetched squadList with ${squadList.length} items`);

            if (squadList.length === 0) {
                await interaction.editReply({ content: 'No squads found in the registry.', ephemeral: true });
                return;
            }

            const ITEMS_PER_PAGE = 10;
            const totalPages = Math.ceil(squadList.length / ITEMS_PER_PAGE);
            console.log(`[Squads] ITEMS_PER_PAGE=${ITEMS_PER_PAGE}, totalPages=${totalPages}`);
            let currentPage = 1;
            const generateEmbed = (page) => {
                const start = (page - 1) * ITEMS_PER_PAGE;
                const end = start + ITEMS_PER_PAGE;
                const pageItems = squadList.slice(start, Math.min(end, squadList.length));

                return new EmbedBuilder()
                    .setColor('#0099ff') // Blue theme
                    .setTitle('Registered Squads')
                    .setDescription(pageItems.length > 0 ? pageItems.join('\n') : 'No squads on this page.')
                    .setFooter({ text: `Page ${page} of ${totalPages}` })
                    .setTimestamp();
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
                embeds: [generateEmbed(currentPage)],
                components: [generateButtons(currentPage)],
                ephemeral: true
            });

        } catch (error) {
            console.error('Error executing /squads command:', error);

            await interaction.editReply({
                content: `An error occurred: ${error.message || 'Please try again later.'}`,
                ephemeral: true
            });
        }
    }
};
