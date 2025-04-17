const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
// const axios = require('axios'); // axios still seems unused
const credentials = require('../resources/secret.json');

// --- Constants ---
const MODERATOR_ROLES = ['805833778064130104', '909227142808756264'];
// SQUAD_OWNER_ROLES, compSquadLevelRoles, contentSquadLevelRoles are not used here, can be removed if desired.

// --- Authorization function ---
function authorize() {
    const { client_email, private_key } = credentials;
    const auth = new google.auth.JWT(
        client_email,
        null,
        private_key,
        ['https://www.googleapis.com/auth/spreadsheets']
    );
    return auth;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('force-squad-name')
        .setDescription('Forcefully change the name of a squad (Mods only).')
        .addStringOption(option =>
            option.setName('squad') // Renamed 'current-name' for clarity? Or keep as 'squad'? Keeping 'squad' as per original.
                .setDescription('The current name of the squad to change.')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('new-name')
                .setDescription('The new name for the squad. (1-4 alphanumeric characters)')
                .setRequired(true)),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const moderatorUserId = interaction.user.id;
        const moderatorUserTag = interaction.user.tag;
        const currentSquadName = interaction.options.getString('squad').toUpperCase(); // Standardize
        const newSquadName = interaction.options.getString('new-name').toUpperCase(); // Standardize
        const guild = interaction.guild; // Use interaction.guild

        // --- Permission Check ---
        const member = await guild.members.fetch(moderatorUserId);
        const isMod = MODERATOR_ROLES.some(roleId => member.roles.cache.has(roleId));
        if (!isMod) {
            return interaction.editReply({
                content: 'You do not have permission to use this command.',
                ephemeral: true
            });
        }

        // --- Input Validation ---
        const squadNamePattern = /^[A-Z0-9]{1,4}$/;
        if (!squadNamePattern.test(newSquadName)) {
            return interaction.editReply({
                content: 'Invalid new squad name. The name must be between 1 and 4 alphanumeric characters.',
                ephemeral: true
            });
        }

        // Prevent changing to the same name
        if (currentSquadName === newSquadName) {
            return interaction.editReply({
                content: 'The new squad name cannot be the same as the current squad name.',
                ephemeral: true
            });
        }


        const auth = authorize();
        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k'; // Store ID for clarity

        try {
            // --- Adjust Ranges for GET requests ---
            const squadLeadersResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: spreadsheetId,
                range: 'Squad Leaders!A:F' // Read full range
            });
            const squadMembersResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: spreadsheetId,
                range: 'Squad Members!A:E' // Read full range
            });
            const allDataResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: spreadsheetId,
                range: 'All Data!A:H' // Read full range
            });

            const squadLeaders = squadLeadersResponse.data.values || [];
            const squadMembers = squadMembersResponse.data.values || [];
            const allData = allDataResponse.data.values || [];

            // --- Find the Squad and Check New Name Availability ---
            // Squad name is column C (index 2)
            const squadLeaderRowIndex = squadLeaders.findIndex(row => row && row.length > 2 && row[2].toUpperCase() === currentSquadName);
            if (squadLeaderRowIndex === -1) {
                return interaction.editReply({
                    content: `The squad **${currentSquadName}** does not exist in the Squad Leaders sheet.`,
                    ephemeral: true
                });
            }
            const squadLeaderRow = squadLeaders[squadLeaderRowIndex]; // Get the row data
            const leaderId = squadLeaderRow[1]; // Leader ID is column B (index 1)

            // Check if the new name is already taken by *another* squad
            const isSquadNameTaken = squadLeaders.some((row, index) => row && row.length > 2 && row[2].toUpperCase() === newSquadName && index !== squadLeaderRowIndex);
            if (isSquadNameTaken) {
                return interaction.editReply({
                    content: `The squad name **${newSquadName}** is already in use. Please choose a different name.`,
                    ephemeral: true
                });
            }

            // --- Adjust data mapping to include ALL columns read ---

            // Squad Leaders: Update index 2 (Squad), preserve others (0, 1, 3, 4, 5)
            const updatedSquadLeaders = squadLeaders.map(row => {
                if (!row || row.length < 3) return row; // Handle invalid rows
                if (row[2].toUpperCase() === currentSquadName) {
                    // Construct the new row with all original columns, updating only index 2
                    return [row[0], row[1], newSquadName, row[3], row[4], row[5]];
                }
                return row; // Return unchanged row if not the target squad
            });

            // Squad Members: Update index 2 (Squad), preserve others (0, 1, 3, 4)
            const updatedSquadMembers = squadMembers.map(row => {
                if (!row || row.length < 3) return row;
                if (row[2].toUpperCase() === currentSquadName) {
                    // Construct the new row with all original columns, updating only index 2
                    return [row[0], row[1], newSquadName, row[3], row[4]];
                }
                return row;
            });

            // All Data: Update index 2 (Squad), preserve others (0, 1, 3, 4, 5, 6, 7)
            const updatedAllData = allData.map(row => {
                if (!row || row.length < 3) return row;
                if (row[2].toUpperCase() === currentSquadName) {
                    // Construct the new row with all original columns, updating only index 2
                    return [row[0], row[1], newSquadName, row[3], row[4], row[5], row[6], row[7]];
                }
                // Pad rows that aren't being updated if they are short
                const fullRow = Array(8).fill('');
                for(let i = 0; i < Math.min(row.length, 8); i++) {
                    fullRow[i] = row[i] !== undefined && row[i] !== null ? row[i] : '';
                }
                return fullRow;
            });

            // --- Adjust Ranges for UPDATE requests ---
            await sheets.spreadsheets.values.update({
                spreadsheetId: spreadsheetId,
                range: 'Squad Leaders!A1:F' + updatedSquadLeaders.length, // Correct Range
                valueInputOption: 'RAW',
                resource: { values: updatedSquadLeaders }
            }).catch(err => { throw new Error(`Failed to update Squad Leaders sheet: ${err.message}`); });


            await sheets.spreadsheets.values.update({
                spreadsheetId: spreadsheetId,
                range: 'Squad Members!A1:E' + updatedSquadMembers.length, // Correct Range
                valueInputOption: 'RAW',
                resource: { values: updatedSquadMembers }
            }).catch(err => { throw new Error(`Failed to update Squad Members sheet: ${err.message}`); });


            await sheets.spreadsheets.values.update({
                spreadsheetId: spreadsheetId,
                range: 'All Data!A1:H' + updatedAllData.length, // Correct Range
                valueInputOption: 'RAW',
                resource: { values: updatedAllData }
            }).catch(err => { throw new Error(`Failed to update All Data sheet: ${err.message}`); });


            // --- Post-update logic (DMs, Nicknames, Logging) ---
            // Use original squadMembers data to find who to notify/update
            const squadMembersToUpdate = squadMembers.filter(row => row && row.length > 2 && row[2].toUpperCase() === currentSquadName);

            // Update Members
            for (const memberRow of squadMembersToUpdate) {
                const memberId = memberRow[1];
                if (!memberId) continue;

                try {
                    const guildMember = await guild.members.fetch(memberId);
                    if (guildMember) {
                        // Send DM - Mention Moderator Action
                        const dmEmbed = new EmbedBuilder()
                            .setTitle('Squad Name Changed')
                            .setDescription(`Your squad's name (**${currentSquadName}**) has been forcefully changed to **${newSquadName}** by a moderator.`)
                            .setColor(0xFFFF00); // Yellow for change/warning
                        await guildMember.send({ embeds: [dmEmbed] }).catch(err => console.log(`Failed to DM ${memberId}: ${err.message}`));

                        // Update Nickname
                        try {
                            await guildMember.setNickname(`[${newSquadName}] ${guildMember.user.username}`);
                        } catch (nickError) {
                            if (nickError.code !== 50013) { // Ignore Missing Permissions
                                console.log(`Could not update nickname for ${guildMember.user.tag} (${memberId}):`, nickError.message);
                            }
                        }
                    }
                } catch (fetchError) {
                    if (fetchError.code === 10007) { console.log(`Member ${memberId} not found in guild, skipping nickname/DM.`); }
                    else { console.log(`Could not fetch member ${memberId} for nickname/DM: ${fetchError.message}`); }
                }
            }

            // Update Leader Nickname
            if (leaderId) {
                try {
                    const leader = await guild.members.fetch(leaderId);
                    if (leader) {
                        try {
                            await leader.setNickname(`[${newSquadName}] ${leader.user.username}`);
                        } catch (nickError) {
                            if (nickError.code !== 50013) { // Ignore Missing Permissions
                                console.log(`Could not update nickname for leader ${leader.user.tag} (${leaderId}):`, nickError.message);
                            }
                        }
                    }
                } catch (fetchError) {
                    if (fetchError.code === 10007) { console.log(`Leader ${leaderId} not found in guild, skipping nickname update.`); }
                    else { console.log(`Could not fetch leader ${leaderId} for nickname update: ${fetchError.message}`); }
                }
            }


            // --- Logging ---
            const loggingChannel = await interaction.client.guilds.fetch('1233740086839869501')
                .then(guild => guild.channels.fetch('1233853415952748645'))
                .catch(() => null);

            if (loggingChannel) {
                try {
                    // Log moderator action with details
                    await loggingChannel.send(`Squad **${currentSquadName}** was forcefully renamed to **${newSquadName}** by moderator **${moderatorUserTag}** (${moderatorUserId}).`);
                } catch (logError) {
                    console.error("Failed to send log message:", logError);
                }
            }

            // --- Success Response ---
            const successEmbed = new EmbedBuilder()
                .setTitle('Squad Name Forcefully Changed')
                .setDescription(`The squad **${currentSquadName}** has been successfully renamed to **${newSquadName}**. Members have been notified and nicknames updated (where possible).`)
                .setColor(0x00FF00); // Green

            await interaction.editReply({ embeds: [successEmbed], ephemeral: true });


        } catch (error) {
            console.error('Error during the force-squad-name command execution:', error);
            let errorMessage = 'An error occurred while changing the squad name. Please try again later.';
            if (error.response?.data?.error) { errorMessage += ` (Details: ${error.response.data.error.message})`; }
            else if (error.message) { errorMessage += ` (Details: ${error.message})`; } // Include errors thrown from sheet updates
            await interaction.editReply({
                content: errorMessage,
                ephemeral: true
            });
        }
    }
};