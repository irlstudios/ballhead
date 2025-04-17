const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
// const axios = require('axios'); // Removed unused import

const sheets = google.sheets('v4');
const auth = new google.auth.GoogleAuth({
    keyFile: 'resources/secret.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets'], // Needs write scope for update/append
});

// --- Constants ---
const SPREADSHEET_ID = '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k';
const LOGGING_CHANNEL_ID = '1233853458092658749';
const LOGGING_GUILD_ID = '1233740086839869501';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('squad-opt-out')
        .setDescription('Opt out of receiving squad invitations.'),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true }); // Defer early

        const userId = interaction.user.id;
        const username = interaction.user.username; // Needed for append

        // Define the function to update preference
        const updatePreference = async (userID, currentUsername) => {
            const client = await auth.getClient();
            // *** UPDATED RANGE ***
            const range = 'All Data!A:H'; // Read the full range including Preference column H

            try {
                const response = await sheets.spreadsheets.values.get({
                    auth: client,
                    spreadsheetId: SPREADSHEET_ID,
                    range,
                });

                const rows = response.data.values || [];
                // Find user row by ID (Column B, index 1)
                let rowIndex = -1;
                const userRow = rows.find((row, index) => {
                    if (row && row.length > 1 && row[1] === userID.toString()) {
                        // +1 because rows index is 0-based, +1 because sheet is 1-based
                        // Adjust if the range starts later than A1
                        rowIndex = index + 1; // Assuming range starts at A1, header is row 1
                        return true;
                    }
                    return false;
                });


                if (userRow && rowIndex > 0) { // Check if user was found
                    // *** UPDATED INDEX ***
                    const prefIndex = 7; // Preference is column H (index 7)

                    // Ensure row has enough columns before checking preference
                    if (userRow.length > prefIndex && userRow[prefIndex] === 'FALSE') {
                        return { success: false, message: "You are already opted out of squad invites." };
                    } else {
                        // Update the preference in the correct column H
                        // *** UPDATED UPDATE RANGE ***
                        const updateRange = `All Data!H${rowIndex}`;
                        console.log(`Updating ${updateRange} to FALSE for user ${userID}`);
                        await sheets.spreadsheets.values.update({
                            auth: client,
                            spreadsheetId: SPREADSHEET_ID,
                            range: updateRange, // Target only the preference column
                            // *** UPDATED VALUE INPUT OPTION ***
                            valueInputOption: 'RAW',
                            requestBody: {
                                values: [['FALSE']], // Value to set
                            },
                        }).catch(err => { throw new Error(`Sheet update failed: ${err.message}`); });
                        return { success: true, message: 'You have successfully opted out of squad invites.' };
                    }
                } else {
                    // User not found, append a new row
                    console.log(`User ${userID} not found in All Data, appending new row.`);
                    // *** UPDATED APPEND DATA ***
                    // Provide values for all 8 columns (A-H)
                    // A=Username, B=ID, C=Squad, D=Type, E=Event, F=Open, G=IsLeader, H=Preference
                    const newRowData = [
                        currentUsername, // A
                        userID.toString(), // B
                        'N/A',          // C
                        'N/A',          // D
                        'N/A',          // E
                        'FALSE',        // F - Default Open Squad to FALSE? Or N/A? Using FALSE as per previous logic.
                        'No',           // G
                        'FALSE'         // H - Set Preference to FALSE
                    ];
                    await sheets.spreadsheets.values.append({
                        auth: client,
                        spreadsheetId: SPREADSHEET_ID,
                        range: 'All Data!A1', // Append after the last row of the specified range (A1 detects table)
                        // *** UPDATED VALUE INPUT OPTION ***
                        valueInputOption: 'RAW',
                        requestBody: {
                            values: [newRowData],
                        },
                    }).catch(err => { throw new Error(`Sheet append failed: ${err.message}`); });
                    return {
                        success: true,
                        message: 'You have been added to the database and opted out of squad invites. You can always revert this change with `/squad-opt-in`.'
                    };
                }
            } catch (error) {
                // Catch specific sheet errors or re-throw generic
                console.error('The API returned an error:', error);
                if (error.message.startsWith('Sheet')) { // If it's one of our thrown errors
                    throw error;
                } else {
                    throw new Error('An error occurred while accessing the sheet.');
                }
            }
        };

        // Execute the update function
        try {
            const result = await updatePreference(userId, username);
            await interaction.editReply({ content: result.message, ephemeral: true });
        } catch (error) {
            console.error(`Error in /squad-opt-out for ${userId}:`, error);
            // Log the error to the designated channel
            try {
                const loggingGuild = await interaction.client.guilds.fetch(LOGGING_GUILD_ID);
                const loggingChannel = await loggingGuild.channels.fetch(LOGGING_CHANNEL_ID);
                const errorEmbed = new EmbedBuilder()
                    .setTitle('Squad Opt-Out Command Error')
                    .setDescription(`**User:** ${interaction.user.tag} (${userId})\n**Error:** ${error.message}`)
                    .setColor('#FF0000') // Red
                    .setTimestamp();
                await loggingChannel.send({ embeds: [errorEmbed] });
            } catch (logError) {
                // If logging fails, log to console
                console.error('Failed to log error to Discord:', logError);
            }

            // Reply to the user about the error
            await interaction.editReply({
                content: 'An error occurred while processing your request. The team has been notified.',
                ephemeral: true
            }).catch(console.error); // Catch potential error editing reply itself
        }
    }
};