const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const credentials = require('../resources/secret.json');

// --- Constants ---
const SPREADSHEET_ID = '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k'; // Use constant
const SQUAD_OWNER_ROLES = ['1218468103382499400', '1288918946258489354', '1290803054140199003'];
// Squad Level Role Arrays (Unchanged)
const compSquadLevelRoles = [
    '1288918067178508423', '1288918165417365576', '1288918209294237707', '1288918281343733842'
];
const contentSquadLevelRoles = [
    '1291090496869109762', '1291090569346682931', '1291090608315699229', '1291090760405356708'
];
// *** ADD Mascot Squad Roles ***
const mascotSquads = [
    { name: "Duck Squad", roleId: "1359614680615620608" },
    { name: "Pumpkin Squad", roleId: "1361466564292907060" },
    { name: "Snowman Squad", roleId: "1361466801443180584" },
    { name: "Gorilla Squad", roleId: "1361466637261471961" },
    { name: "Bee Squad", roleId: "1361466746149666956" },
    { name: "Alligator Squad", roleId: "1361466697059664043" },
];
// Column Indices (0-based)
// Squad Leaders (A:F)
const SL_ID = 1;
const SL_SQUAD_NAME = 2;
const SL_EVENT_SQUAD = 3; // Column D
// All Data (A:H)
const AD_SQUAD_NAME = 2;
const AD_SQUAD_TYPE = 3; // Column D
const AD_PREFERENCE = 7; // Column H

// --- Authorization function ---
function authorize() {
    const { client_email, private_key } = credentials;
    const auth = new google.auth.JWT(client_email, null, private_key, ['https://www.googleapis.com/auth/spreadsheets']);
    return auth;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('disband-squad')
        .setDescription('Disband your squad if you are the squad leader.'),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const userId = interaction.user.id;
        const userTag = interaction.user.tag;
        const guild = interaction.guild;
        const auth = authorize();
        const sheets = google.sheets({ version: 'v4', auth });

        try {
            // --- Get Data ---
            const [squadLeadersResponse, squadMembersResponse, allDataResponse] = await Promise.all([
                sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Squad Leaders!A:F' }),
                sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Squad Members!A:E' }),
                sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'All Data!A:H' })
            ]).catch(err => { throw new Error("Failed to retrieve data from Google Sheets.") });

            const squadLeaders = (squadLeadersResponse.data.values || []).slice(1); // Skip header
            const squadMembers = (squadMembersResponse.data.values || []).slice(1); // Skip header
            const allData = (allDataResponse.data.values || []).slice(1); // Skip header

            // --- Leader Check ---
            const userSquadLeaderRow = squadLeaders.find(row => row && row.length > SL_ID && row[SL_ID] === userId);
            if (!userSquadLeaderRow) { /* ... not leader reply ... */
                return interaction.editReply({ content: 'You do not own a squad, so you cannot disband one.', ephemeral: true });
            }
            const squadName = userSquadLeaderRow[SL_SQUAD_NAME];
            if (!squadName || squadName === 'N/A') { /* ... invalid squad name ... */
                return interaction.editReply({ content: 'Could not determine your squad name.', ephemeral: true });
            }

            // --- Determine Roles to Remove ---
            // 1. Squad Type Roles
            const squadTypeRow = allData.find(row => row && row.length > AD_SQUAD_TYPE && row[AD_SQUAD_NAME] === squadName);
            const squadTypeForRoles = squadTypeRow ? squadTypeRow[AD_SQUAD_TYPE] : null;
            const squadTypeRolesToRemove = squadTypeForRoles === 'Competitive' ? compSquadLevelRoles :
                squadTypeForRoles === 'Content' ? contentSquadLevelRoles : [];

            // 2. Mascot Role
            const eventSquadName = userSquadLeaderRow[SL_EVENT_SQUAD]; // Get from Leader row (Col D / index 3)
            let mascotRoleIdToRemove = null;
            if (eventSquadName && eventSquadName !== 'N/A') {
                const mascotInfo = mascotSquads.find(m => m.name === eventSquadName);
                if (mascotInfo) {
                    mascotRoleIdToRemove = mascotInfo.roleId;
                    console.log(`Squad ${squadName} identified with mascot role: ${eventSquadName} (${mascotRoleIdToRemove})`);
                } else {
                    console.warn(`Squad ${squadName} has event squad '${eventSquadName}' but no matching role ID found.`);
                }
            }

            // --- Member Notification and Cleanup ---
            const squadMembersToProcess = squadMembers.filter(row => row && row.length > 2 && row[2] === squadName);
            const memberIdsToProcess = squadMembersToProcess.map(row => row[1]); // Get IDs for All Data update

            for (const memberRow of squadMembersToProcess) {
                const memberId = memberRow[1];
                if (!memberId) continue;
                try {
                    const member = await guild.members.fetch(memberId);
                    if (member) {
                        // Send DM
                        const dmEmbed = new EmbedBuilder()
                            .setTitle('Squad Disbanded')
                            .setDescription(`The squad **${squadName}** you were in has been disbanded by the squad leader.`)
                            .setColor(0xFF0000);
                        await member.send({ embeds: [dmEmbed] }).catch(err => console.log(`Failed to DM ${memberId}: ${err.message}`));

                        // Reset Nickname
                        if (member.nickname && member.nickname.toUpperCase().startsWith(`[${squadName}]`)) {
                            await member.setNickname(member.user.username).catch(nickError => {
                                if (nickError.code !== 50013) { console.log(`Could not reset nickname for ${member.user.tag} (${memberId}):`, nickError.message); }
                            });
                        }

                        // Remove Roles (Squad Type + Mascot)
                        const rolesToRemoveFromMember = [...squadTypeRolesToRemove];
                        if (mascotRoleIdToRemove) {
                            rolesToRemoveFromMember.push(mascotRoleIdToRemove);
                        }
                        if (rolesToRemoveFromMember.length > 0) {
                            console.log(`Attempting to remove roles [${rolesToRemoveFromMember.join(', ')}] from member ${member.user.tag}`);
                            await member.roles.remove(rolesToRemoveFromMember).catch(roleErr => {
                                if (roleErr.code !== 50013 && roleErr.code !== 10011 ) { // Ignore Missing Perms / Unknown Role
                                    console.log(`Failed to remove roles from ${member.user.tag} (${memberId}):`, roleErr.message);
                                }
                            });
                        }
                    }
                } catch (fetchError) { /* ... handle member fetch error ... */
                    if (fetchError.code === 10007) { console.log(`Member ${memberId} not found in guild, skipping cleanup.`); }
                    else { console.log(`Could not fetch member ${memberId} for cleanup: ${fetchError.message}`); }
                }
            }

            // --- Leader Cleanup ---
            try {
                const leader = await guild.members.fetch(userId);
                if (leader) {
                    // Remove Owner Roles
                    const ownerRolesToRemove = SQUAD_OWNER_ROLES.filter(roleId => leader.roles.cache.has(roleId));
                    if (ownerRolesToRemove.length > 0) {
                        await leader.roles.remove(ownerRolesToRemove).catch(roleErr => { /* ... error handling ... */
                            if (roleErr.code !== 50013 && roleErr.code !== 10011) { console.log(`Failed to remove owner roles from leader ${leader.user.tag}:`, roleErr.message); }
                        });
                    }

                    // Reset Nickname
                    if (leader.nickname && leader.nickname.toUpperCase().startsWith(`[${squadName}]`)) {
                        await leader.setNickname(leader.user.username).catch(nickError => { /* ... error handling ... */
                            if (nickError.code !== 50013) { console.log(`Could not reset nickname for leader ${leader.user.tag}:`, nickError.message); }
                        });
                    }

                    // Remove Roles (Squad Type + Mascot)
                    const rolesToRemoveFromLeader = [...squadTypeRolesToRemove];
                    if (mascotRoleIdToRemove) {
                        rolesToRemoveFromLeader.push(mascotRoleIdToRemove);
                    }
                    if (rolesToRemoveFromLeader.length > 0) {
                        console.log(`Attempting to remove roles [${rolesToRemoveFromLeader.join(', ')}] from leader ${leader.user.tag}`);
                        await leader.roles.remove(rolesToRemoveFromLeader).catch(roleErr => { /* ... error handling ... */
                            if (roleErr.code !== 50013 && roleErr.code !== 10011) { console.log(`Failed to remove level/mascot roles from leader ${leader.user.tag}:`, roleErr.message); }
                        });
                    }
                }
            } catch (fetchError) { /* ... handle leader fetch error ... */
                if (fetchError.code === 10007) { console.log(`Leader ${userId} not found in guild, skipping cleanup.`); }
                else { console.log(`Could not fetch leader ${userId} for cleanup: ${fetchError.message}`); }
            }

            // --- Prepare Sheet Updates ---
            const updatedSquadMembers = squadMembers.filter(row => row && row.length > 2 && row[2] !== squadName);
            const updatedSquadLeaders = squadLeaders.filter(row => row && row.length > 1 && row[1] !== userId);
            const disbandedMemberIds = new Set(memberIdsToProcess);
            disbandedMemberIds.add(userId);

            // Update All Data Map (Format remains correct)
            const updatedAllData = allData.map(row => {
                if (!row || row.length < 2) return row;
                const memberId = row[1];
                if (disbandedMemberIds.has(memberId)) {
                    const preference = row.length > AD_PREFERENCE ? row[AD_PREFERENCE] : '';
                    return [ row[0], row[1], 'N/A', 'N/A', 'N/A', 'FALSE', 'No', preference ];
                } else {
                    const fullRow = Array(8).fill('');
                    for(let i = 0; i < Math.min(row.length, 8); i++) { fullRow[i] = row[i] ?? ''; }
                    return fullRow;
                }
            });

            // --- Execute Sheet Updates ---
            // Re-add headers before writing full data
            const finalSquadMembers = [squadMembersResponse.data.values[0], ...updatedSquadMembers]; // Use original fetched header
            const finalSquadLeaders = [squadLeadersResponse.data.values[0], ...updatedSquadLeaders];
            const finalAllData = [allDataResponse.data.values[0], ...updatedAllData];

            // Clear and Update (More reliable than just update for removing rows)
            await sheets.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range: 'Squad Members!A2:E' }).catch(err => console.error("Error clearing Squad Members:", err.response?.data || err.message));
            if (updatedSquadMembers.length > 0) {
                await sheets.spreadsheets.values.update({ spreadsheetId: SPREADSHEET_ID, range: 'Squad Members!A2', valueInputOption: 'RAW', resource: { values: updatedSquadMembers } }).catch(err => console.error("Error updating Squad Members:", err.response?.data || err.message));
            }
            await sheets.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range: 'Squad Leaders!A2:F' }).catch(err => console.error("Error clearing Squad Leaders:", err.response?.data || err.message));
            if (updatedSquadLeaders.length > 0) {
                await sheets.spreadsheets.values.update({ spreadsheetId: SPREADSHEET_ID, range: 'Squad Leaders!A2', valueInputOption: 'RAW', resource: { values: updatedSquadLeaders } }).catch(err => console.error("Error updating Squad Leaders:", err.response?.data || err.message));
            }
            // Update All Data (Overwriting whole sheet is simplest here)
            await sheets.spreadsheets.values.update({ spreadsheetId: SPREADSHEET_ID, range: 'All Data!A1:H', valueInputOption: 'RAW', resource: { values: finalAllData } }).catch(err => console.error("Error updating All Data:", err.response?.data || err.message));


            // --- Logging ---
            const loggingChannel = await interaction.client.guilds.fetch('1233740086839869501') /* ... */ .then(guild => guild?.channels.fetch('1233853415952748645')).catch(() => null);
            if (loggingChannel) { /* ... send log message ... */
                try { await loggingChannel.send(`The squad **${squadName}** was disbanded by **${userTag}** (${userId}).`); } catch (logError) { console.error("Failed to send log message:", logError); }
            }

            // --- Success Response ---
            const successEmbed = new EmbedBuilder()
                .setTitle('Squad Disbanded')
                .setDescription(`Your squad **${squadName}** has been successfully disbanded. Members have been notified, roles removed (including squad level and mascot roles), and nicknames reset (where possible).`) // Added role detail
                .setColor(0x00FF00);
            await interaction.editReply({ embeds: [successEmbed], ephemeral: true });

        } catch (error) {
            console.error('Error during the disband-squad command execution:', error);
            let errorMessage = 'An error occurred while disbanding the squad. Please try again later.'; /* ... error message construction ... */
            if (error.response?.data?.error) { errorMessage += ` (Details: ${error.response.data.error.message})`; } else if (error.message) { errorMessage += ` (Details: ${error.message})`; }
            await interaction.editReply({ content: errorMessage, ephemeral: true }).catch(console.error); // Catch error editing reply
        }
    }
};