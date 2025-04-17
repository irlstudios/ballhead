const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
// const axios = require('axios'); // Unused import
const credentials = require('../resources/secret.json');

// --- Constants ---
const GUILD_ID = '752216589792706621';
const LOGGING_GUILD_ID = '1233740086839869501';
const LOGGING_CHANNEL_ID = '1233853415952748645';
const ERROR_LOG_CHANNEL_ID = '1233853458092658749';
const SPREADSHEET_ID = '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k'; // Use constant

// --- Authorization function ---
function authorize() {
    const { client_email, private_key } = credentials;
    return new google.auth.JWT(client_email, null, private_key, ['https://www.googleapis.com/auth/spreadsheets']);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leave-squad')
        .setDescription('Leave your current squad'),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true }); // Defer reply early

        const userId = interaction.user.id;
        // const username = interaction.user.username; // userTag is preferred
        const userTag = interaction.user.tag; // Better for logging

        const auth = authorize();
        const sheets = google.sheets({ version: 'v4', auth });

        try {
            // --- Get Data with Corrected Ranges ---
            const squadMembersResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: 'Squad Members!A:E', // Correct Range A:E
            });
            const squadLeadersResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: 'Squad Leaders!A:F', // Correct Range A:F
            });
            const allDataResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: 'All Data!A:H', // Correct Range A:H
            });

            // Extract data, handle potential empty sheets
            const squadMembersData = squadMembersResponse.data.values || [];
            const squadLeadersData = squadLeadersResponse.data.values || [];
            const allDataValues = allDataResponse.data.values || [];

            // Data without headers
            const squadMembers = squadMembersData.slice(1);
            const squadLeaders = squadLeadersData.slice(1);
            const allData = allDataValues.slice(1);

            // --- Check if user is Leader or in Squad ---
            const userIsLeader = squadLeaders.find(row => row && row.length > 1 && row[1]?.trim() === userId);
            if (userIsLeader) {
                return interaction.editReply({ content: 'Sorry, squad leaders cannot leave their squad using this command. Please use `/disband-squad` or transfer ownership (if implemented).', ephemeral: true });
            }

            const userInSquadRowIndex = squadMembers.findIndex(row => row && row.length > 1 && row[1]?.trim() === userId);
            if (userInSquadRowIndex === -1) {
                return interaction.editReply({ content: 'You are not currently in a squad.', ephemeral: true });
            }

            const userInSquadRow = squadMembers[userInSquadRowIndex];
            const squadName = userInSquadRow[2]?.trim();

            if (!squadName || squadName === 'N/A') {
                console.warn(`User ${userTag} (${userId}) found in Squad Members sheet but without a valid squad name in row: ${JSON.stringify(userInSquadRow)}`);
                return interaction.editReply({ content: 'Your squad data seems inconsistent. Please contact an administrator.', ephemeral: true });
            }

            console.log(`User ${userTag} (${userId}) is leaving squad: ${squadName}`);

            // --- Update Squad Members Sheet ---
            // *** CHANGE HERE: Use clear instead of update ***
            const squadMemberSheetRowIndex = userInSquadRowIndex + 2; // +1 for 0-based index, +1 for header
            const clearRange = `Squad Members!A${squadMemberSheetRowIndex}:E${squadMemberSheetRowIndex}`; // Correct Range A:E
            console.log(`Clearing Squad Members range ${clearRange}`);
            await sheets.spreadsheets.values.clear({
                spreadsheetId: SPREADSHEET_ID,
                range: clearRange,
            }).catch(err => { throw new Error(`Failed to clear row in Squad Members sheet: ${err.message}`); });


            // --- Update All Data Sheet ---
            const userInAllDataIndex = allData.findIndex(row => row && row.length > 1 && row[1]?.trim() === userId);
            if (userInAllDataIndex !== -1) {
                const allDataSheetRowIndex = userInAllDataIndex + 2;
                // Columns: C=Squad, D=Type, E=Event, F=Open, G=IsLeader
                const rangeToUpdate = `All Data!C${allDataSheetRowIndex}:G${allDataSheetRowIndex}`; // Correct Range C:G
                const valuesToUpdate = [['N/A', 'N/A', 'N/A', 'FALSE', 'No']]; // Correct values
                console.log(`Updating All Data range ${rangeToUpdate} for user ${userId}`);

                await sheets.spreadsheets.values.update({
                    spreadsheetId: SPREADSHEET_ID,
                    range: rangeToUpdate,
                    valueInputOption: 'RAW',
                    resource: { values: valuesToUpdate },
                }).catch(err => { throw new Error(`Failed to update row in All Data sheet: ${err.message}`); });

            } else {
                console.warn(`User ${userTag} (${userId}) was found in Squad Members but not in All Data sheet.`);
            }

            // --- Notify Squad Leader ---
            // Find leader by squad name (column C, index 2)
            const squadOwnerRow = squadLeaders.find(row => row && row.length > 2 && row[2]?.trim() === squadName);
            if (squadOwnerRow && squadOwnerRow[1]) {
                const ownerId = squadOwnerRow[1].trim();
                const ownerUsername = squadOwnerRow[0] || `Leader`;
                try {
                    const ownerUser = await interaction.client.users.fetch(ownerId);
                    const dmEmbed = new EmbedBuilder() /* ... DM embed ... */
                        .setTitle('Member Left Squad')
                        .setDescription(`Hello ${ownerUsername},\nUser **${userTag}** (<@${userId}>) has left your squad **${squadName}**.`)
                        .setColor('#FFA500');
                    await ownerUser.send({ embeds: [dmEmbed] }).catch(dmError => {
                        console.error(`Failed to DM squad leader ${ownerId}: ${dmError.message}`);
                    });
                } catch (error) {
                    console.error(`Failed to fetch squad leader user ${ownerId} for DM: ${error.message}`);
                }
            } else {
                console.warn(`Could not find leader for squad ${squadName} to notify.`);
            }

            // --- Log Action ---
            try {
                const loggingGuild = await interaction.client.guilds.fetch(LOGGING_GUILD_ID);
                const loggingChannel = await loggingGuild.channels.fetch(LOGGING_CHANNEL_ID);
                const logEmbed = new EmbedBuilder() /* ... Log embed ... */
                    .setTitle('Member Left Squad')
                    .setDescription(`User **${userTag}** (<@${userId}>) has left the squad **${squadName}**.`)
                    .setColor('#FFA500')
                    .setTimestamp();
                await loggingChannel.send({ embeds: [logEmbed] });
            } catch (logError) {
                console.error(`Failed to send log message: ${logError.message}`);
            }


            // --- Reset Nickname ---
            try {
                const guild = interaction.guild || await interaction.client.guilds.fetch(GUILD_ID);
                const member = await guild.members.fetch(userId);
                if (member.nickname && member.nickname.toUpperCase().startsWith(`[${squadName.toUpperCase()}]`)) {
                    console.log(`Resetting nickname for ${userTag}`);
                    await member.setNickname(null);
                } else {
                    console.log(`Nickname for ${userTag} doesn't match squad format, not resetting.`);
                }
            } catch (error) { /* ... Nickname error handling ... */
                if (error.code === 50013) { console.log(`Missing permissions to reset nickname for ${userTag} (${userId}).`); }
                else if (error.code === 10007) { console.log(`Member ${userTag} (${userId}) not found in guild ${GUILD_ID}, cannot reset nickname.`); }
                else { console.error(`Could not change nickname for ${userTag} (${userId}):`, error.message); }
            }

            // --- Send Success Reply ---
            await interaction.editReply({
                content: `You have successfully left the squad **${squadName}**.`,
                ephemeral: true,
            });

        } catch (error) {
            console.error(`Error during /leave-squad for ${userTag} (${userId}):`, error);
            // --- Error Logging ---
            try {
                const errorGuild = await interaction.client.guilds.fetch(LOGGING_GUILD_ID);
                const errorChannel = await errorGuild.channels.fetch(ERROR_LOG_CHANNEL_ID);
                const errorEmbed = new EmbedBuilder() /* ... Error log embed ... */
                    .setTitle('Leave Squad Command Error')
                    .setDescription(`**User:** ${userTag} (${userId})\n**Error:** ${error.message}`)
                    .setColor('#FF0000')
                    .setTimestamp();
                await errorChannel.send({ embeds: [errorEmbed] });
            } catch (logError) {
                console.error(`Failed to log error to error channel: ${logError.message}`);
            }
            // --- Error Reply ---
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ /* ... Error reply ... */ content: 'An error occurred while processing your request...', ephemeral: true }).catch(console.error);
            } else if (!interaction.replied) {
                await interaction.editReply({ /* ... Error reply ... */ content: 'An error occurred while processing your request...', ephemeral: true }).catch(console.error);
            }
        }
    },
};