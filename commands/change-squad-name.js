const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const credentials = require('../resources/secret.json');

// --- Authorization function remains the same ---
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
        .setName('change-squad-name')
        .setDescription('Change the name of your squad if you are the squad leader.')
        .addStringOption(option =>
            option.setName('new-name')
                .setDescription('The new name for your squad. (1-4 alphanumeric characters)')
                .setRequired(true)),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const userId = interaction.user.id;
        const newSquadName = interaction.options.getString('new-name').toUpperCase();
        const guild = interaction.guild;

        // --- Input validation remains the same ---
        const squadNamePattern = /^[A-Z0-9]{1,4}$/;
        if (!squadNamePattern.test(newSquadName)) {
            return interaction.editReply({
                content: 'Invalid squad name. The name must be between 1 and 4 alphanumeric characters.',
                ephemeral: true
            });
        }

        const auth = authorize();
        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k'; // Store ID for clarity

        try {
            // --- Adjust Ranges for GET requests ---
            // Squad Leaders NEW Format: Discord Username (A), Discord ID (B), Squad (C), Event Squad (D), Open Squad (E), Squad Made (F)
            const squadLeadersResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: spreadsheetId,
                range: 'Squad Leaders!A:F' // Read up to column F
            });

            // Squad Members NEW Format: Discord Username (A), Discord ID (B), Squad (C), Event Squad (D), Joined Squad (E)
            const squadMembersResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: spreadsheetId,
                range: 'Squad Members!A:E' // Read up to column E
            });

            // All Data NEW Format: Discord Username (A), Discord ID (B), Squad (C), Squad Type (D), Event Squad (E), Open Squad (F), Is Squad Leader (G), Preference (H)
            const allDataResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: spreadsheetId,
                range: 'All Data!A:H' // Read up to column H
            });

            // --- Data extraction remains similar, null checks are good ---
            const squadLeaders = squadLeadersResponse.data.values || [];
            const squadMembers = squadMembersResponse.data.values || [];
            const allData = allDataResponse.data.values || [];

            // Find the leader row (checks Discord ID in column B - index 1, still correct)
            const leaderRowIndex = squadLeaders.findIndex(row => row && row.length > 1 && row[1] === userId); // Use findIndex to easily update later if needed
            if (leaderRowIndex === -1) {
                return interaction.editReply({
                    content: 'You do not own a squad, so you cannot change the squad name.',
                    ephemeral: true
                });
            }
            const userSquadLeaderRow = squadLeaders[leaderRowIndex];
            const currentSquadName = userSquadLeaderRow[2]; // Squad name is still column C - index 2

            // Check if new name is taken (checks Squad name in column C - index 2, still correct)
            // Exclude the current leader's row from the check
            const isSquadNameTaken = squadLeaders.some((row, index) => row && row.length > 2 && row[2] === newSquadName && index !== leaderRowIndex);
            if (isSquadNameTaken) {
                return interaction.editReply({
                    content: `The squad name ${newSquadName} is already in use. Please choose a different name.`,
                    ephemeral: true
                });
            }

            // --- Adjust data mapping to include ALL columns read ---

            // Squad Leaders: Update index 2 (Squad), preserve others (0, 1, 3, 4, 5)
            const updatedSquadLeaders = squadLeaders.map(row => {
                // Ensure row is valid and has enough columns before accessing indices
                if (!row || row.length < 3) return row; // Return unchanged if row is invalid/short
                if (row[1] === userId) {
                    // Construct the new row with all original columns, updating only index 2
                    return [row[0], row[1], newSquadName, row[3], row[4], row[5]];
                }
                return row; // Return unchanged row if not the target leader
            });


            // Squad Members: Update index 2 (Squad), preserve others (0, 1, 3, 4)
            const updatedSquadMembers = squadMembers.map(row => {
                if (!row || row.length < 3) return row;
                if (row[2] === currentSquadName) {
                    // Construct the new row with all original columns, updating only index 2
                    return [row[0], row[1], newSquadName, row[3], row[4]];
                }
                return row;
            });


            // All Data: Update index 2 (Squad), preserve others (0, 1, 3, 4, 5, 6, 7)
            const updatedAllData = allData.map(row => {
                if (!row || row.length < 3) return row;
                if (row[2] === currentSquadName) {
                    // Construct the new row with all original columns, updating only index 2
                    return [row[0], row[1], newSquadName, row[3], row[4], row[5], row[6], row[7]];
                }
                return row;
            });

            // --- Adjust Ranges for UPDATE requests ---
            await sheets.spreadsheets.values.update({
                spreadsheetId: spreadsheetId,
                range: 'Squad Leaders!A:F', // Update full range
                valueInputOption: 'RAW',
                resource: { values: updatedSquadLeaders }
            });

            await sheets.spreadsheets.values.update({
                spreadsheetId: spreadsheetId,
                range: 'Squad Members!A:E', // Update full range
                valueInputOption: 'RAW',
                resource: { values: updatedSquadMembers }
            });

            await sheets.spreadsheets.values.update({
                spreadsheetId: spreadsheetId,
                range: 'All Data!A:H', // Update full range
                valueInputOption: 'RAW',
                resource: { values: updatedAllData }
            });

            // --- Post-update logic (DMs, Nicknames, Logging) remains the same ---
            // Need to filter based on the *original* squadMembers data before it was mapped
            const squadMembersToNotify = squadMembers.filter(row => row && row.length > 2 && row[2] === currentSquadName);
            for (const memberRow of squadMembersToNotify) {
                if (!memberRow || memberRow.length < 2) continue; // Skip invalid rows
                const memberId = memberRow[1];
                try {
                    const member = await guild.members.fetch(memberId);
                    if (member) {
                        const dmEmbed = new EmbedBuilder()
                            .setTitle('Squad Name Changed')
                            .setDescription(`The squad name has been changed from **${currentSquadName}** to **${newSquadName}** by the squad leader.`)
                            .setColor(0x00FF00);
                        await member.send({ embeds: [dmEmbed] }).catch(err => console.log(`Failed to DM ${memberId}: ${err.message}`));

                        // Update nickname
                        try {
                            await member.setNickname(`[${newSquadName}] ${member.user.username}`);
                        } catch (error) {
                            // Ignore permissions errors, log others maybe
                            if (error.code !== 50013) { // Missing Permissions
                                console.log(`Could not update nickname for ${member.user.tag} (${memberId}):`, error.message);
                            }
                        }
                    }
                } catch (error) {
                    console.log(`Could not fetch member ${memberId} for notification: ${error.message}`);
                }
            }

            // Update leader's nickname
            try {
                const leader = await guild.members.fetch(userId);
                if (leader) {
                    try {
                        await leader.setNickname(`[${newSquadName}] ${leader.user.username}`);
                    } catch (error) {
                        if (error.code !== 50013) { // Missing Permissions
                            console.log(`Could not update nickname for leader ${leader.user.tag} (${userId}):`, error.message);
                        }
                    }
                }
            } catch (error) {
                console.log(`Could not fetch leader ${userId} for nickname update: ${error.message}`);
            }


            // Logging
            const loggingChannel = await interaction.client.guilds.fetch('1233740086839869501')
                .then(guild => guild.channels.fetch('1233853415952748645'))
                .catch(() => null);

            if (loggingChannel) {
                try {
                    await loggingChannel.send(`The squad **${currentSquadName}** has been renamed to **${newSquadName}** by **${interaction.user.tag}** (${interaction.user.id}).`);
                } catch (logError) {
                    console.error("Failed to send log message:", logError);
                }
            }

            // --- Success response remains the same ---
            const successEmbed = new EmbedBuilder()
                .setTitle('Squad Name Changed')
                .setDescription(`Your squad name has been successfully changed from **${currentSquadName}** to **${newSquadName}**. All members have been notified and nicknames updated (where possible).`)
                .setColor(0x00FF00);

            await interaction.editReply({ embeds: [successEmbed], ephemeral: true });

        } catch (error) {
            console.error('Error during the change-squad-name command execution:', error);
            // Improve error reporting if possible
            let errorMessage = 'An error occurred while changing the squad name. Please try again later.';
            if (error.response && error.response.data && error.response.data.error) {
                errorMessage += ` (Details: ${error.response.data.error.message})`;
            } else if (error.message) {
                errorMessage += ` (Details: ${error.message})`;
            }
            await interaction.editReply({
                content: errorMessage,
                ephemeral: true
            });
        }
    }
};