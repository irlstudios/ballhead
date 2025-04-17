const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { google } = require('googleapis');
const credentials = require('../resources/secret.json'); // Assuming credentials path is correct

// --- Constants ---
const SPREADSHEET_ID = '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k';
// Add logging constants if needed
// const LOGGING_CHANNEL_ID = '...';
// const ERROR_LOGGING_CHANNEL_ID = '...';

// --- Authorization function (Consistent Pattern) ---
function authorize() {
    const { client_email, private_key } = credentials;
    const auth = new google.auth.JWT(
        client_email,
        null,
        private_key,
        // Readonly scope should be sufficient here, but read/write is fine too.
        ['https://www.googleapis.com/auth/spreadsheets']
    );
    return auth;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('squads')
        .setDescription('Lists all registered squads and their owners.'), // Slightly clearer description
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const auth = authorize();
        const sheets = google.sheets({ version: 'v4', auth });

        // Helper function to get squad list data
        async function getSquadList() {
            // *** UPDATED RANGE ***
            // Read the full range A:F for robustness, even though we only use B and C currently.
            const range = `'Squad Leaders'!A:F`;
            try {
                const response = await sheets.spreadsheets.values.get({
                    auth: auth, // Use the authorized client directly
                    spreadsheetId: SPREADSHEET_ID,
                    range,
                });
                const rows = response.data.values || [];

                // Skip header row (assuming first row is header)
                const dataRows = rows.slice(1);

                if (dataRows.length > 0) {
                    // Map data - Owner ID (Col B, index 1), Squad Name (Col C, index 2) - Indices are correct
                    return dataRows
                        .filter(row => row && row.length > 2 && row[1] && row[2]) // Ensure row, ID, and Name exist
                        .map(row => {
                            const squadName = row[2].trim();
                            const ownerId = row[1].trim();
                            return `- **${squadName}** (Owner: <@${ownerId}>)`; // Format list item
                        });
                } else {
                    return []; // Return empty array if no data rows
                }
            } catch (error) {
                console.error('The API returned an error while fetching squad leaders:', error);
                // Re-throw a more specific error to be caught by the main handler
                throw new Error('Failed to fetch squad list from the sheet.');
            }
        }

        try {
            const squadList = await getSquadList();

            if (squadList.length === 0) {
                await interaction.editReply({ content: 'No squads found in the registry.', ephemeral: true });
                return;
            }

            const ITEMS_PER_PAGE = 10;
            const totalPages = Math.ceil(squadList.length / ITEMS_PER_PAGE);
            let currentPage = 1; // Start at page 1

            // Function to generate the embed for the current page
            const generateEmbed = (page) => {
                const start = (page - 1) * ITEMS_PER_PAGE;
                const end = start + ITEMS_PER_PAGE;
                // Ensure slicing doesn't go out of bounds
                const pageItems = squadList.slice(start, Math.min(end, squadList.length));

                return new EmbedBuilder()
                    .setColor('#0099ff') // Blue theme
                    .setTitle('Registered Squads')
                    .setDescription(pageItems.length > 0 ? pageItems.join('\n') : 'No squads on this page.') // Handle empty page case
                    .setFooter({ text: `Page ${page} of ${totalPages}` })
                    .setTimestamp();
            };

            // Function to generate the action row with buttons
            const generateButtons = (page) => {
                return new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('squads_prev') // Unique custom ID prefix
                            .setLabel('Previous')
                            .setStyle(ButtonStyle.Primary)
                            .setDisabled(page === 1), // Disable if on first page
                        new ButtonBuilder()
                            .setCustomId('squads_next') // Unique custom ID prefix
                            .setLabel('Next')
                            .setStyle(ButtonStyle.Primary)
                            .setDisabled(page === totalPages) // Disable if on last page
                    );
            }

            // --- Send Initial Reply ---
            // NOTE: The interaction collector logic to handle button clicks is missing here.
            // This code only sets up the initial display. A separate handler
            // listening for 'interactionCreate' with button custom IDs 'squads_prev'/'squads_next'
            // would be needed to make pagination functional.

            await interaction.editReply({
                embeds: [generateEmbed(currentPage)],
                components: [generateButtons(currentPage)],
                ephemeral: true
            });

        } catch (error) {
            console.error('Error executing /squads command:', error);
            // Log detailed error if needed
            // try { ... log to error channel ... } catch { ... }
            await interaction.editReply({
                content: `An error occurred: ${error.message || 'Please try again later.'}`,
                ephemeral: true
            });
        }
    }
};