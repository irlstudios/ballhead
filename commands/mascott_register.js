const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const credentials = require('../resources/secret.json');

// --- Constants ---
const SPREADSHEET_ID = '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k';
// Logging constants (optional, add if needed)
// const LOGGING_GUILD_ID = '...';
// const LOGGING_CHANNEL_ID = '...';
// const ERROR_LOGGING_CHANNEL_ID = '...';

// Mascot Squad Data Structure
const mascotSquads = [
    { name: "Duck Squad", roleId: "1359614680615620608" },
    { name: "Pumpkin Squad", roleId: "1361466564292907060" },
    { name: "Snowman Squad", roleId: "1361466801443180584" },
    { name: "Gorilla Squad", roleId: "1361466637261471961" },
    { name: "Bee Squad", roleId: "1361466746149666956" },
    { name: "Alligator Squad", roleId: "1361466697059664043" },
];

// --- Authorization Function ---
function authorize() {
    const { client_email, private_key } = credentials;
    const auth = new google.auth.JWT(
        client_email,
        null,
        private_key,
        ['https://www.googleapis.com/auth/spreadsheets'] // Read/Write needed
    );
    return auth;
}

// Column Indices (0-based) for clarity
// Squad Leaders (A:F)
const SL_ID = 1;
const SL_SQUAD_NAME = 2;
const SL_EVENT_SQUAD = 3; // Column D
const SL_OPEN_SQUAD = 4;  // Column E
// Squad Members (A:E)
const SM_ID = 1;
const SM_SQUAD_NAME = 2;
const SM_EVENT_SQUAD = 3; // Column D
// All Data (A:H)
const AD_ID = 1;
const AD_SQUAD_NAME = 2;
const AD_EVENT_SQUAD = 4; // Column E
const AD_OPEN_SQUAD = 5;  // Column F


module.exports = {
    data: new SlashCommandBuilder()
        .setName('mascot_register')
        .setDescription('Register your squad for the mascot event (Squad Leaders only).'),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const leaderUserId = interaction.user.id;
        const leaderUserTag = interaction.user.tag;
        const guild = interaction.guild; // Get guild from interaction

        if (!guild) {
            await interaction.editReply({ content: 'This command must be run in a server.', ephemeral: true });
            return;
        }

        const auth = authorize();
        const sheets = google.sheets({ version: 'v4', auth });

        try {
            // --- Fetch All Required Sheet Data ---
            const [squadLeadersResponse, squadMembersResponse, allDataResponse] = await Promise.all([
                sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Squad Leaders!A:F' }),
                sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Squad Members!A:E' }),
                sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'All Data!A:H' }),
            ]).catch(err => {
                console.error("Error fetching initial sheet data:", err);
                throw new Error("Failed to retrieve necessary data from Google Sheets.");
            });

            const squadLeadersData = squadLeadersResponse.data.values || [];
            const squadMembersData = squadMembersResponse.data.values || [];
            const allDataData = allDataResponse.data.values || [];

            const squadLeadersHeader = squadLeadersData.shift() || []; // Remove/store header
            const squadMembersHeader = squadMembersData.shift() || [];
            const allDataHeader = allDataData.shift() || [];

            // --- Check 1: Is the user a squad leader? ---
            let leaderRowIndex = -1;
            const leaderRow = squadLeadersData.find((row, index) => {
                if (row && row.length > SL_ID && row[SL_ID] === leaderUserId) {
                    leaderRowIndex = index; // Store the 0-based index within the data array
                    return true;
                }
                return false;
            });

            if (!leaderRow || leaderRowIndex === -1) {
                await interaction.editReply({ content: 'You must be a squad leader to use this command.', ephemeral: true });
                return;
            }

            const leaderSquadName = leaderRow[SL_SQUAD_NAME];
            if (!leaderSquadName || leaderSquadName === 'N/A') {
                await interaction.editReply({ content: 'Could not determine your squad name. Please contact an admin.', ephemeral: true });
                return;
            }

            // --- Check 2: Already registered? ---
            const currentEventSquad = leaderRow[SL_EVENT_SQUAD];
            if (currentEventSquad && currentEventSquad !== 'N/A') {
                await interaction.editReply({ content: `Your squad **${leaderSquadName}** is already registered for the event as **${currentEventSquad}**.`, ephemeral: true });
                return;
            }

            // --- Get Squad Members ---
            const memberIds = squadMembersData
                .filter(row => row && row.length > SM_SQUAD_NAME && row[SM_SQUAD_NAME] === leaderSquadName && row[SM_ID]) // Filter by squad name and ensure ID exists
                .map(row => row[SM_ID]); // Get member IDs

            const allParticipantIds = [...new Set([leaderUserId, ...memberIds])]; // Combine leader + members, ensure unique
            const participantIdSet = new Set(allParticipantIds); // Use a Set for faster lookups later

            // --- Randomly Select Mascot Squad ---
            const randomIndex = Math.floor(Math.random() * mascotSquads.length);
            const chosenMascot = mascotSquads[randomIndex];
            console.log(`Squad ${leaderSquadName} randomly assigned to ${chosenMascot.name}`);

            // --- Prepare Sheet Updates ---
            // Map Squad Leaders Data
            const updatedSquadLeaders = squadLeadersData.map((row, index) => {
                if (index === leaderRowIndex) { // Update only the leader's row
                    const newRow = [...row]; // Create a copy
                    // Ensure row has enough columns before assigning
                    while (newRow.length <= Math.max(SL_EVENT_SQUAD, SL_OPEN_SQUAD)) { newRow.push(''); }
                    newRow[SL_EVENT_SQUAD] = chosenMascot.name; // Update Event Squad (D/3)
                    newRow[SL_OPEN_SQUAD] = 'TRUE'; // Update Open Squad (E/4)
                    return newRow;
                }
                return row; // Return other rows unchanged
            });

            // Map Squad Members Data
            const updatedSquadMembers = squadMembersData.map(row => {
                if (row && row.length > SM_ID && participantIdSet.has(row[SM_ID])) { // Check if this member is in the leader's squad
                    const newRow = [...row];
                    while (newRow.length <= SM_EVENT_SQUAD) { newRow.push(''); }
                    newRow[SM_EVENT_SQUAD] = chosenMascot.name; // Update Event Squad (D/3)
                    return newRow;
                }
                return row; // Return other rows unchanged
            });

            // Map All Data
            const updatedAllData = allDataData.map(row => {
                if (row && row.length > AD_ID && participantIdSet.has(row[AD_ID])) { // Check if user is part of the squad
                    const newRow = [...row];
                    while (newRow.length <= Math.max(AD_EVENT_SQUAD, AD_OPEN_SQUAD)) { newRow.push(''); }
                    newRow[AD_EVENT_SQUAD] = chosenMascot.name; // Update Event Squad (E/4)
                    newRow[AD_OPEN_SQUAD] = 'TRUE'; // Update Open Squad (F/5)
                    return newRow;
                }
                // Ensure non-squad rows maintain consistent length (optional but good practice)
                const fullRow = Array(allDataHeader.length).fill('');
                for(let i = 0; i < Math.min(row?.length ?? 0, allDataHeader.length); i++) {
                    fullRow[i] = row[i] !== undefined && row[i] !== null ? row[i] : '';
                }
                return fullRow;
            });

            // --- Execute Sheet Updates ---
            // Add headers back before writing
            const finalSquadLeaders = [squadLeadersHeader, ...updatedSquadLeaders];
            const finalSquadMembers = [squadMembersHeader, ...updatedSquadMembers];
            const finalAllData = [allDataHeader, ...updatedAllData];

            // Use Promise.all for concurrent updates
            await Promise.all([
                sheets.spreadsheets.values.update({
                    spreadsheetId: SPREADSHEET_ID,
                    range: 'Squad Leaders!A1:F', // Update full range
                    valueInputOption: 'RAW',
                    resource: { values: finalSquadLeaders }
                }),
                sheets.spreadsheets.values.update({
                    spreadsheetId: SPREADSHEET_ID,
                    range: 'Squad Members!A1:E', // Update full range
                    valueInputOption: 'RAW',
                    resource: { values: finalSquadMembers }
                }),
                sheets.spreadsheets.values.update({
                    spreadsheetId: SPREADSHEET_ID,
                    range: 'All Data!A1:H', // Update full range
                    valueInputOption: 'RAW',
                    resource: { values: finalAllData }
                })
            ]).catch(err => {
                console.error("Error updating sheets:", err);
                throw new Error("Failed to update one or more Google Sheets.");
            });
            console.log(`Sheets updated for squad ${leaderSquadName} registration.`);

            // --- Update Discord Roles ---
            const roleToAdd = await guild.roles.fetch(chosenMascot.roleId).catch(() => null);
            if (!roleToAdd) {
                console.error(`Could not find role ID ${chosenMascot.roleId} (${chosenMascot.name}) in guild ${guild.id}.`);
                // Don't fail the whole command, but notify admin in reply
                await interaction.followUp({ content: `Warning: Could not find the Discord role for ${chosenMascot.name}. Sheet data updated, but roles not assigned.`, ephemeral: true });
            } else {
                const roleUpdatePromises = [];
                const failedRoleUpdates = [];
                console.log(`Assigning role ${roleToAdd.name} (${roleToAdd.id}) to ${allParticipantIds.length} users.`);

                for (const userId of allParticipantIds) {
                    roleUpdatePromises.push(
                        guild.members.fetch(userId)
                            .then(member => member.roles.add(roleToAdd))
                            .catch(err => {
                                console.warn(`Failed to add role ${roleToAdd.name} to user ${userId}: ${err.message}`);
                                failedRoleUpdates.push(`<@${userId}>`); // Collect IDs that failed
                            })
                    );
                }
                await Promise.all(roleUpdatePromises);

                if (failedRoleUpdates.length > 0) {
                    // Notify admin if some roles failed
                    await interaction.followUp({ content: `Warning: Could not assign the ${chosenMascot.name} role to the following users (check permissions or if they left): ${failedRoleUpdates.join(', ')}`, ephemeral: true });
                }
            }

            // --- Success Reply ---
            const successEmbed = new EmbedBuilder()
                .setColor('#00FF00') // Green
                .setTitle('Mascot Event Registration Successful!')
                .setDescription(`Your squad **${leaderSquadName}** has been successfully registered for the event and randomly assigned to the **${chosenMascot.name}**!\n\nRelevant roles and sheet data have been updated.`)
                .setTimestamp();

            await interaction.editReply({ embeds: [successEmbed], ephemeral: true });

        } catch (error) {
            console.error(`Error processing /mascot_register for ${leaderUserTag}:`, error);
            // Log error (optional)
            // try { ... log to error channel ... } catch { ... }
            await interaction.editReply({
                content: `An error occurred: ${error.message || 'Please try again later.'}`,
                ephemeral: true
            }).catch(console.error); // Catch error editing reply itself
        }
    }
};