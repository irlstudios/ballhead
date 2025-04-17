const { SlashCommandBuilder, EmbedBuilder } = require('discord.js'); // Use EmbedBuilder from discord.js
const { google } = require('googleapis');
// const axios = require('axios'); // Removed unused import
const credentials = require('../resources/secret.json');

// --- Authorization function (Consistent with previous commands) ---
function authorize() {
    const { client_email, private_key } = credentials;
    const auth = new google.auth.JWT(
        client_email,
        null,
        private_key,
        ['https://www.googleapis.com/auth/spreadsheets'] // Read/Write scope needed for update
    );
    return auth;
}

// --- Constants ---
const SPREADSHEET_ID = '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k';
// Add logging constants if needed, similar to opt-out
// const LOGGING_CHANNEL_ID = '1233853458092658749';
// const LOGGING_GUILD_ID = '1233740086839869501';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('squad-opt-in')
        .setDescription('Opt back into receiving squad invitations.'), // Slightly clearer description
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const userId = interaction.user.id;
        const auth = authorize();
        const sheets = google.sheets({ version: 'v4', auth });

        try {
            // *** UPDATED RANGE ***
            const range = 'All Data!A:H'; // Read full range including Preference (H)
            const allDataResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: range,
            });

            const allData = allDataResponse.data.values || [];

            // Find user row and its index (relative to the start of the read data)
            let dataRowIndex = -1;
            const userRow = allData.find((row, index) => {
                // Check column B (index 1) for user ID
                if (row && row.length > 1 && row[1] === userId.toString()) {
                    dataRowIndex = index;
                    return true;
                }
                return false;
            });

            if (!userRow || dataRowIndex === -1) {
                // User not found in the sheet at all
                await interaction.editReply({
                    content: 'Your data could not be found in the system. If you believe this is an error, please contact an admin.',
                    ephemeral: true
                });
                return;
            }

            // Calculate the actual sheet row number
            // Assuming the range starts at A1, the dataRowIndex needs +1 to match sheet rows
            const sheetRowIndex = dataRowIndex + 1;

            // *** UPDATED INDEX & CHECK ***
            const prefIndex = 7; // Preference is column H (index 7)

            // Check if already opted in
            if (userRow.length > prefIndex && userRow[prefIndex] === 'TRUE') {
                await interaction.editReply({
                    content: 'You are already opted in to receive squad invitations.',
                    ephemeral: true
                });
                return;
            }

            // *** UPDATED UPDATE LOGIC ***
            const updateRange = `All Data!H${sheetRowIndex}`; // Target only the preference column H
            console.log(`Updating ${updateRange} to TRUE for user ${userId}`);

            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: updateRange,
                // *** UPDATED VALUE INPUT OPTION ***
                valueInputOption: 'RAW',
                requestBody: { // Use requestBody consistently
                    values: [['TRUE']] // Set value to TRUE
                }
            }).catch(err => { throw new Error(`Sheet update failed: ${err.message}`); });


            // --- Success Response ---
            const successEmbed = new EmbedBuilder()
                .setTitle('Squad Invitation Opt-In')
                .setDescription('You have successfully opted back in to receive squad invitations.')
                .setColor('#00FF00') // Green for success
                .setTimestamp();

            await interaction.editReply({ embeds: [successEmbed], ephemeral: true });

        } catch (error) {
            console.error(`Error during squad-opt-in command for ${userId}:`, error);
            // Add logging to channel if desired
            // try { ... log error ... } catch { ... }

            await interaction.editReply({
                content: 'An error occurred while processing your request. Please try again later.',
                ephemeral: true
            });
        }
    }
};