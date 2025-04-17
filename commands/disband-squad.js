const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const credentials = require('../resources/secret.json');

// --- Constants remain the same ---
const SQUAD_OWNER_ROLES = ['1218468103382499400', '1288918946258489354', '1290803054140199003'];
const compSquadLevelRoles = [
    '1288918067178508423',
    '1288918165417365576',
    '1288918209294237707',
    '1288918281343733842'
];
const contentSquadLevelRoles = [
    '1291090496869109762',
    '1291090569346682931',
    '1291090608315699229',
    '1291090760405356708'
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
        .setName('disband-squad')
        .setDescription('Disband your squad if you are the squad leader.'),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const userId = interaction.user.id;
        const userTag = interaction.user.tag; // Use tag for logging
        const guild = interaction.guild;
        const auth = authorize();
        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k'; // Store ID for clarity

        try {
            // --- Get Data (Ranges are correct from previous update) ---
            const squadLeadersResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: spreadsheetId,
                range: 'Squad Leaders!A:F'
            });
            const squadMembersResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: spreadsheetId,
                range: 'Squad Members!A:E'
            });
            const allDataResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: spreadsheetId,
                range: 'All Data!A:H'
            });

            const squadLeaders = squadLeadersResponse.data.values || [];
            const squadMembers = squadMembersResponse.data.values || [];
            const allData = allDataResponse.data.values || [];

            // --- Leader Check (Logic remains the same) ---
            const userSquadLeaderRow = squadLeaders.find(row => row && row.length > 1 && row[1] === userId);
            if (!userSquadLeaderRow) {
                return interaction.editReply({
                    content: 'You do not own a squad, so you cannot disband one.',
                    ephemeral: true
                });
            }
            const squadName = userSquadLeaderRow[2];

            // --- Role Determination (Logic remains the same) ---
            const squadTypeRow = allData.find(row => row && row.length > 3 && row[2] === squadName);
            const squadTypeForRoles = squadTypeRow ? squadTypeRow[3] : null;
            const squadTypeRoles = squadTypeForRoles === 'Competitive' ? compSquadLevelRoles :
                squadTypeForRoles === 'Content' ? contentSquadLevelRoles : [];

            // --- Member Notification and Cleanup (Logic remains the same) ---
            const squadMembersToProcess = squadMembers.filter(row => row && row.length > 2 && row[2] === squadName);
            const memberIdsToProcess = squadMembersToProcess.map(row => row[1]);

            for (const memberRow of squadMembersToProcess) {
                const memberId = memberRow[1];
                if (!memberId) continue;
                try {
                    const member = await guild.members.fetch(memberId);
                    if (member) {
                        const dmEmbed = new EmbedBuilder() /* ... DM embed ... */
                            .setTitle('Squad Disbanded')
                            .setDescription(`The squad **${squadName}** you were in has been disbanded by the squad leader.`)
                            .setColor(0xFF0000);
                        await member.send({ embeds: [dmEmbed] }).catch(err => console.log(`Failed to DM ${memberId}: ${err.message}`));
                        if (member.nickname && member.nickname.startsWith(`[${squadName}]`)) {
                            await member.setNickname(member.user.username).catch(nickError => { /* ... error handling ... */
                                if (nickError.code !== 50013) { console.log(`Could not reset nickname for ${member.user.tag} (${memberId}):`, nickError.message); }
                            });
                        }
                        if (squadTypeRoles.length > 0) {
                            await member.roles.remove(squadTypeRoles).catch(roleErr => { /* ... error handling ... */
                                if (roleErr.code !== 50013 && roleErr.code !== 10011 ) { console.log(`Failed to remove roles from ${member.user.tag} (${memberId}):`, roleErr.message); }
                            });
                        }
                    }
                } catch (fetchError) { /* ... error handling ... */
                    if (fetchError.code === 10007) { console.log(`Member ${memberId} not found in guild, skipping cleanup.`); }
                    else { console.log(`Could not fetch member ${memberId} for cleanup: ${fetchError.message}`); }
                }
            }

            // --- Leader Cleanup (Logic remains the same) ---
            try {
                const leader = await guild.members.fetch(userId);
                if (leader) {
                    const rolesToRemove = SQUAD_OWNER_ROLES.filter(roleId => leader.roles.cache.has(roleId));
                    if (rolesToRemove.length > 0) {
                        await leader.roles.remove(rolesToRemove).catch(roleErr => { /* ... error handling ... */
                            if (roleErr.code !== 50013 && roleErr.code !== 10011) { console.log(`Failed to remove owner roles from leader ${leader.user.tag} (${userId}):`, roleErr.message); }
                        });
                    }
                    if (leader.nickname && leader.nickname.startsWith(`[${squadName}]`)) {
                        await leader.setNickname(leader.user.username).catch(nickError => { /* ... error handling ... */
                            if (nickError.code !== 50013) { console.log(`Could not reset nickname for leader ${leader.user.tag} (${userId}):`, nickError.message); }
                        });
                    }
                    if (squadTypeRoles.length > 0) {
                        await leader.roles.remove(squadTypeRoles).catch(roleErr => { /* ... error handling ... */
                            if (roleErr.code !== 50013 && roleErr.code !== 10011) { console.log(`Failed to remove level roles from leader ${leader.user.tag} (${userId}):`, roleErr.message); }
                        });
                    }
                }
            } catch (fetchError) { /* ... error handling ... */
                if (fetchError.code === 10007) { console.log(`Leader ${userId} not found in guild, skipping cleanup.`); }
                else { console.log(`Could not fetch leader ${userId} for cleanup: ${fetchError.message}`); }
            }

            // --- Prepare Sheet Updates ---
            const updatedSquadMembers = squadMembers.filter(row => row && row.length > 2 && row[2] !== squadName);
            const updatedSquadLeaders = squadLeaders.filter(row => row && row.length > 1 && row[1] !== userId);
            const disbandedMemberIds = new Set(memberIdsToProcess);
            disbandedMemberIds.add(userId);

            // *** ADJUSTMENT HERE ***
            // Update All Data: Reset squad info according to the specified format
            const updatedAllData = allData.map(row => {
                if (!row || row.length < 2) return row;
                const memberId = row[1];

                if (disbandedMemberIds.has(memberId)) {
                    // Format: {username} | {id} | N/A | N/A | N/A | FALSE | No | {preference}
                    const preference = row.length > 7 ? row[7] : ''; // Get existing preference or default
                    return [
                        row[0],      // Discord Username (Index 0)
                        row[1],      // Discord ID (Index 1)
                        'N/A',       // Squad (Index 2)
                        'N/A',       // Squad Type (Index 3)
                        'N/A',       // Event Squad (Index 4)
                        'FALSE',     // Open Squad (Index 5) <-- **CHANGED TO 'FALSE'**
                        'No',        // Is Squad Leader (Index 6)
                        preference   // Preference (Index 7)
                    ];
                } else {
                    // User not in disbanded squad, return row unchanged, padding if necessary
                    const fullRow = Array(8).fill('');
                    for(let i = 0; i < Math.min(row.length, 8); i++) {
                        fullRow[i] = row[i] !== undefined && row[i] !== null ? row[i] : ''; // Ensure null/undefined become empty strings
                    }
                    return fullRow;
                }
            });

            // --- Execute Sheet Updates (Logic remains the same, ranges are correct) ---
            await sheets.spreadsheets.values.clear({ spreadsheetId: spreadsheetId, range: 'Squad Members!A:E' /* ... */ }).catch(err => console.error("Error clearing Squad Members:", err.response?.data || err.message));
            if (updatedSquadMembers.length > 0) {
                await sheets.spreadsheets.values.update({ spreadsheetId: spreadsheetId, range: 'Squad Members!A1:E' + updatedSquadMembers.length, valueInputOption: 'RAW', resource: { values: updatedSquadMembers } /* ... */ }).catch(err => console.error("Error updating Squad Members:", err.response?.data || err.message));
            }
            await sheets.spreadsheets.values.clear({ spreadsheetId: spreadsheetId, range: 'Squad Leaders!A:F' /* ... */ }).catch(err => console.error("Error clearing Squad Leaders:", err.response?.data || err.message));
            if (updatedSquadLeaders.length > 0) {
                await sheets.spreadsheets.values.update({ spreadsheetId: spreadsheetId, range: 'Squad Leaders!A1:F' + updatedSquadLeaders.length, valueInputOption: 'RAW', resource: { values: updatedSquadLeaders } /* ... */ }).catch(err => console.error("Error updating Squad Leaders:", err.response?.data || err.message));
            }
            await sheets.spreadsheets.values.update({ spreadsheetId: spreadsheetId, range: 'All Data!A1:H' + updatedAllData.length, valueInputOption: 'RAW', resource: { values: updatedAllData } /* ... */ }).catch(err => console.error("Error updating All Data:", err.response?.data || err.message));

            // --- Logging (Logic remains the same) ---
            const loggingChannel = await interaction.client.guilds.fetch('1233740086839869501') /* ... */ .then(guild => guild.channels.fetch('1233853415952748645')).catch(() => null);
            if (loggingChannel) {
                try { await loggingChannel.send(`The squad **${squadName}** was disbanded by **${userTag}** (${userId}).`); } catch (logError) { console.error("Failed to send log message:", logError); }
            }

            // --- Success Response (Logic remains the same) ---
            const successEmbed = new EmbedBuilder() /* ... success embed ... */
                .setTitle('Squad Disbanded')
                .setDescription(`Your squad **${squadName}** has been successfully disbanded. Members have been notified, roles removed, and nicknames reset (where possible).`)
                .setColor(0x00FF00);
            await interaction.editReply({ embeds: [successEmbed], ephemeral: true });

        } catch (error) {
            console.error('Error during the disband-squad command execution:', error);
            let errorMessage = 'An error occurred while disbanding the squad. Please try again later.'; /* ... error message construction ... */
            if (error.response?.data?.error) { errorMessage += ` (Details: ${error.response.data.error.message})`; } else if (error.message) { errorMessage += ` (Details: ${error.message})`; }
            await interaction.editReply({ content: errorMessage, ephemeral: true });
        }
    }
};