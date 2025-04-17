const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const credentials = require('../resources/secret.json');

// --- Constants (Role IDs seem correct) ---
const MODERATOR_ROLES = ['805833778064130104', '909227142808756264'];
const SQUAD_OWNER_ROLES = ['1218468103382499400', '1288918946258489354', '1290803054140199003'];
const compSquadLevelRoles = [
    '1288918067178508423', '1288918165417365576', '1288918209294237707', '1288918281343733842', '1200889836844896316'
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
        .setName('force-disband')
        .setDescription('Force disband a squad by its name (Mods only).')
        .addStringOption(option =>
            option.setName('squad-name')
                .setDescription('The name of the squad to disband.')
                .setRequired(true)
        ),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const squadNameToDisband = interaction.options.getString('squad-name').toUpperCase(); // Standardize input
        const moderatorUserId = interaction.user.id;
        const moderatorUserTag = interaction.user.tag;
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

        const auth = authorize();
        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k';

        try {
            // --- Adjust Ranges for GET requests ---
            const squadLeadersResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: spreadsheetId,
                range: 'Squad Leaders!A:F' // Correct range
            });
            const squadMembersResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: spreadsheetId,
                range: 'Squad Members!A:E' // Correct range
            });
            const allDataResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: spreadsheetId,
                range: 'All Data!A:H' // Correct range
            });

            const squadLeaders = squadLeadersResponse.data.values || [];
            const squadMembers = squadMembersResponse.data.values || [];
            const allData = allDataResponse.data.values || [];

            // --- Find the Squad Leader by Name ---
            const squadLeaderRow = squadLeaders.find(row => row && row.length > 2 && row[2].toUpperCase() === squadNameToDisband);
            if (!squadLeaderRow) {
                return interaction.editReply({
                    content: `Squad **${squadNameToDisband}** does not exist in the Squad Leaders sheet.`,
                    ephemeral: true
                });
            }

            const squadLeaderId = squadLeaderRow[1]; // Leader ID is column B (index 1)

            // --- Determine Roles to Remove ---
            const squadTypeRow = allData.find(row => row && row.length > 3 && row[2].toUpperCase() === squadNameToDisband);
            const squadTypeForRoles = squadTypeRow ? squadTypeRow[3] : null;
            const squadTypeRoles = squadTypeForRoles === 'Competitive' ? compSquadLevelRoles :
                squadTypeForRoles === 'Content' ? contentSquadLevelRoles : [];

            // *** Get Mascot Role ID ***
            const eventSquadName = squadLeaderRow[3]; // Get Event Squad from Leader
            let mascotRoleIdToRemove = null;
            if (eventSquadName && eventSquadName !== 'N/A') {
                const mascotInfo = mascotSquads.find(m => m.name === eventSquadName);
                if (mascotInfo) {
                    mascotRoleIdToRemove = mascotInfo.roleId;
                    console.log(`Squad ${squadNameToDisband} has mascot role: ${eventSquadName} (${mascotRoleIdToRemove})`);
                } else {
                    console.warn(`Squad ${squadNameToDisband} has event squad '${eventSquadName}' but no matching role ID found.`);
                }
            }

            // --- Member Notification and Cleanup ---
            const squadMembersToProcess = squadMembers.filter(row => row && row.length > 2 && row[2].toUpperCase() === squadNameToDisband);
            const memberIdsToProcess = squadMembersToProcess.map(row => row[1]);

            for (const memberRow of squadMembersToProcess) {
                const memberId = memberRow[1];
                if (!memberId) continue;

                try {
                    const guildMember = await guild.members.fetch(memberId);
                    if (guildMember) {
                        // Send DM
                        const dmEmbed = new EmbedBuilder()
                            .setTitle('Squad Disbanded')
                            .setDescription(`The squad **${squadNameToDisband}** you were in has been forcefully disbanded by a moderator.`)
                            .setColor(0xFF0000); // Red
                        await guildMember.send({ embeds: [dmEmbed] }).catch(err => console.log(`Failed to DM ${memberId}: ${err.message}`));

                        // Reset Nickname
                        try {
                            if (guildMember.nickname && guildMember.nickname.toUpperCase().startsWith(`[${squadNameToDisband}]`)) {
                                await guildMember.setNickname(guildMember.user.username);
                            }
                        } catch (nickError) {
                            if (nickError.code !== 50013) { console.log(`Could not reset nickname for ${guildMember.user.tag} (${memberId}):`, nickError.message); }
                        }

                        // Remove Roles (Squad Level + Mascot, if any)
                        const rolesToRemoveFromMember = [...squadTypeRoles]; // Create a copy of squadTypeRoles
                        if (mascotRoleIdToRemove) {
                            rolesToRemoveFromMember.push(mascotRoleIdToRemove); // Add mascot role if found
                        }
                        // Make sure there are any roles to remove before the API call
                        if (rolesToRemoveFromMember.length > 0) {
                            await guildMember.roles.remove(rolesToRemoveFromMember).catch(roleErr => {
                                if (roleErr.code !== 50013 && roleErr.code !== 10011 ) { console.log(`Failed to remove roles from ${guildMember.user.tag} (${memberId}):`, roleErr.message); }
                            });
                        }

                    }
                } catch (fetchError) {
                    if (fetchError.code === 10007) { console.log(`Member ${memberId} not found in guild, skipping cleanup.`); }
                    else { console.log(`Could not fetch member ${memberId} for cleanup: ${fetchError.message}`); }
                }
            }

            // --- Leader Notification and Cleanup ---
            try {
                const leader = await guild.members.fetch(squadLeaderId);
                if (leader) {
                    // Send DM - Mention Moderator Action
                    const leaderEmbed = new EmbedBuilder()
                        .setTitle('Your Squad Was Disbanded')
                        .setDescription(`Your squad **${squadNameToDisband}** has been forcefully disbanded by a moderator.`)
                        .setColor(0xFF0000); // Red
                    await leader.send({ embeds: [leaderEmbed] }).catch(err => console.log(`Failed to DM leader ${squadLeaderId}: ${err.message}`));

                    // Remove Squad Owner Roles
                    const rolesToRemove = SQUAD_OWNER_ROLES.filter(roleId => leader.roles.cache.has(roleId));
                    if (rolesToRemove.length > 0) {
                        await leader.roles.remove(rolesToRemove).catch(roleErr => {
                            if (roleErr.code !== 50013 && roleErr.code !== 10011) { console.log(`Failed to remove owner roles from leader ${leader.user.tag} (${squadLeaderId}):`, roleErr.message); }
                        });
                    }

                    // Reset Nickname
                    try {
                        if (leader.nickname && leader.nickname.toUpperCase().startsWith(`[${squadNameToDisband}]`)) {
                            await leader.setNickname(leader.user.username);
                        }
                    } catch (nickError) {
                        if (nickError.code !== 50013) { console.log(`Could not reset nickname for leader ${leader.user.tag} (${squadLeaderId}):`, nickError.message); }
                    }

                    // Remove Squad Level + Mascot Roles
                    const rolesToRemoveFromLeader = [...squadTypeRoles];
                    if (mascotRoleIdToRemove) {
                        rolesToRemoveFromLeader.push(mascotRoleIdToRemove);
                    }

                    if (rolesToRemoveFromLeader.length > 0) {
                        console.log(`Attempting to remove roles [${rolesToRemoveFromLeader.join(', ')}] from leader ${leader.user.tag}`);
                        await leader.roles.remove(rolesToRemoveFromLeader).catch(roleErr => {
                            if (roleErr.code !== 50013 && roleErr.code !== 10011) { console.log(`Failed to remove squad level/mascot roles from leader ${leader.user.tag}:`, roleErr.message); }
                        });
                    }
                }
            } catch (fetchError) {
                if (fetchError.code === 10007) { console.log(`Leader ${squadLeaderId} not found in guild, skipping cleanup.`); }
                else { console.log(`Could not fetch leader ${squadLeaderId} for cleanup: ${fetchError.message}`); }
            }

            // --- Prepare Sheet Updates ---
            const updatedSquadMembers = squadMembers.filter(row => row && row.length > 2 && row[2].toUpperCase() !== squadNameToDisband);
            const updatedSquadLeaders = squadLeaders.filter(row => row && row.length > 1 && row[1] !== squadLeaderId);
            const disbandedMemberIds = new Set(memberIdsToProcess);
            disbandedMemberIds.add(squadLeaderId);

            const updatedAllData = allData.map(row => {
                if (!row || row.length < 2) return row;
                const memberId = row[1];

                if (disbandedMemberIds.has(memberId)) {
                    const preference = row.length > 7 ? row[7] : ''; // Get existing preference
                    return [
                        row[0],      // Discord Username (Index 0)
                        row[1],      // Discord ID (Index 1)
                        'N/A',       // Squad (Index 2)
                        'N/A',       // Squad Type (Index 3)
                        'N/A',       // Event Squad (Index 4)
                        'FALSE',     // Open Squad (Index 5)
                        'No',        // Is Squad Leader (Index 6)
                        preference   // Preference (Index 7)
                    ];
                } else {
                    const fullRow = Array(8).fill('');
                    for(let i = 0; i < Math.min(row.length, 8); i++) {
                        fullRow[i] = row[i] !== undefined && row[i] !== null ? row[i] : '';
                    }
                    return fullRow;
                }
            });


            // --- Execute Sheet Updates ---
            await sheets.spreadsheets.values.clear({
                spreadsheetId: spreadsheetId,
                range: 'Squad Members!A:E' // Correct Range
            }).catch(err => console.error("Error clearing Squad Members:", err.response?.data || err.message));

            if (updatedSquadMembers.length > 0) {
                await sheets.spreadsheets.values.update({
                    spreadsheetId: spreadsheetId,
                    range: 'Squad Members!A1:E' + updatedSquadMembers.length, // Use specific range
                    valueInputOption: 'RAW',
                    resource: { values: updatedSquadMembers }
                }).catch(err => console.error("Error updating Squad Members:", err.response?.data || err.message));
            }

            await sheets.spreadsheets.values.clear({
                spreadsheetId: spreadsheetId,
                range: 'Squad Leaders!A:F' // Correct Range
            }).catch(err => console.error("Error clearing Squad Leaders:", err.response?.data || err.message));

            if (updatedSquadLeaders.length > 0) {
                await sheets.spreadsheets.values.update({
                    spreadsheetId: spreadsheetId,
                    range: 'Squad Leaders!A1:F' + updatedSquadLeaders.length, // Use specific range
                    valueInputOption: 'RAW',
                    resource: { values: updatedSquadLeaders }
                }).catch(err => console.error("Error updating Squad Leaders:", err.response?.data || err.message));
            }

            await sheets.spreadsheets.values.update({
                spreadsheetId: spreadsheetId,
                range: 'All Data!A:H',
                valueInputOption: 'RAW',
                resource: { values: updatedAllData }
            }).catch(err => console.error("Error updating All Data:", err.response?.data || err.message));

            // --- Logging ---
            const loggingChannel = await interaction.client.guilds.fetch('1233740086839869501')
                .then(guild => guild.channels.fetch('1233853415952748645'))
                .catch(() => null);

            if (loggingChannel) {
                try {
                    // Log moderator action
                    await loggingChannel.send(`The squad **${squadNameToDisband}** was forcefully disbanded by moderator **${moderatorUserTag}** (${moderatorUserId}).`);
                } catch (logError) {
                    console.error("Failed to send log message:", logError);
                }
            }

            // --- Success Response for Moderator ---
            const successEmbed = new EmbedBuilder()
                .setTitle('Squad Forcefully Disbanded')
                .setDescription(`The squad **${squadNameToDisband}** has been successfully disbanded. Members have been notified, roles removed, and nicknames reset (where possible), including mascot role (if assigned).`) // Updated message
                .setColor(0x00FF00); // Green

            await interaction.editReply({ embeds: [successEmbed], ephemeral: true });

        } catch (error) {
            console.error('Error during the force-disband command execution:', error);
            let errorMessage = 'An error occurred while forcefully disbanding the squad. Please try again later.';
            if (error.response?.data?.error) { errorMessage += ` (Details: ${error.response.data.error.message})`; }
            else if (error.message) { errorMessage += ` (Details: ${error.message})`; }
            await interaction.editReply({
                content: errorMessage,
                ephemeral: true
            });
        }
    }
};