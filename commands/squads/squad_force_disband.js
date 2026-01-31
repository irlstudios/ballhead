const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const { getSheetsClient } = require('../../utils/sheets_cache');

const MODERATOR_ROLES = ['805833778064130104', '909227142808756264'];
const SQUAD_OWNER_ROLES = ['1218468103382499400', '1288918946258489354', '1290803054140199003'];
const compSquadLevelRoles = [
    '1288918067178508423', '1288918165417365576', '1288918209294237707', '1288918281343733842', '1200889836844896316'
];
const contentSquadLevelRoles = [
    '1291090496869109762', '1291090569346682931', '1291090608315699229', '1291090760405356708'
];
const mascotSquads = [
    { name: 'Duck Squad', roleId: '1359614680615620608' },
    { name: 'Pumpkin Squad', roleId: '1361466564292907060' },
    { name: 'Snowman Squad', roleId: '1361466801443180584' },
    { name: 'Gorilla Squad', roleId: '1361466637261471961' },
    { name: 'Bee Squad', roleId: '1361466746149666956' },
    { name: 'Alligator Squad', roleId: '1361466697059664043' },
];

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

        const squadNameToDisband = interaction.options.getString('squad-name').toUpperCase();
        const moderatorUserId = interaction.user.id;
        const moderatorUserTag = interaction.user.tag;
        const guild = interaction.guild;

        const member = await guild.members.fetch(moderatorUserId);
        const isMod = MODERATOR_ROLES.some(roleId => member.roles.cache.has(roleId));

        if (!isMod) {
            const container = new ContainerBuilder();
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent('## Access Denied'),
                new TextDisplayBuilder().setContent('You do not have permission to use this command.')
            );
            return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true });
        }

        const sheets = await getSheetsClient();
        const spreadsheetId = '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k';

        try {
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

            const squadLeaderRow = squadLeaders.find(row => row && row.length > 2 && row[2].toUpperCase() === squadNameToDisband);
            if (!squadLeaderRow) {
                const container = new ContainerBuilder();
                container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('## Squad Not Found'),
                    new TextDisplayBuilder().setContent(`Squad **${squadNameToDisband}** does not exist in the Squad Leaders sheet.`)
                );
                return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true });
            }

            const squadLeaderId = squadLeaderRow[1];

            const squadTypeRow = allData.find(row => row && row.length > 3 && row[2].toUpperCase() === squadNameToDisband);
            const squadTypeForRoles = squadTypeRow ? squadTypeRow[3] : null;
            const squadTypeRoles = squadTypeForRoles === 'Competitive' ? compSquadLevelRoles :
                squadTypeForRoles === 'Content' ? contentSquadLevelRoles : [];

            const eventSquadName = squadLeaderRow[3];
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

            const squadMembersToProcess = squadMembers.filter(row => row && row.length > 2 && row[2].toUpperCase() === squadNameToDisband);
            const memberIdsToProcess = squadMembersToProcess.map(row => row[1]);

            for (const memberRow of squadMembersToProcess) {
                const memberId = memberRow[1];
                if (!memberId) continue;

                try {
                    const guildMember = await guild.members.fetch(memberId);
                    if (guildMember) {
                        const dmContainer = new ContainerBuilder();
                        dmContainer.addTextDisplayComponents(
                            new TextDisplayBuilder().setContent('## Squad Disbanded\nModerator Action'),
                            new TextDisplayBuilder().setContent(`The squad **${squadNameToDisband}** you were in has been forcefully disbanded by a moderator.`)
                        );
                        await guildMember.send({ flags: MessageFlags.IsComponentsV2, components: [dmContainer] }).catch(err => console.log(`Failed to DM ${memberId}: ${err.message}`));

                        try {
                            if (guildMember.nickname && guildMember.nickname.toUpperCase().startsWith(`[${squadNameToDisband}]`)) {
                                await guildMember.setNickname(guildMember.user.username);
                            }
                        } catch (nickError) {
                            if (nickError.code !== 50013) { console.log(`Could not reset nickname for ${guildMember.user.tag} (${memberId}):`, nickError.message); }
                        }

                        const rolesToRemoveFromMember = [...squadTypeRoles];
                        if (mascotRoleIdToRemove) {
                            rolesToRemoveFromMember.push(mascotRoleIdToRemove);
                        }
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

            try {
                const leader = await guild.members.fetch(squadLeaderId);
                if (leader) {
                    const leaderContainer = new ContainerBuilder();
                    leaderContainer.addTextDisplayComponents(
                        new TextDisplayBuilder().setContent('## Your Squad Was Disbanded\nModerator Action'),
                        new TextDisplayBuilder().setContent(`Your squad **${squadNameToDisband}** has been forcefully disbanded by a moderator.`)
                    );
                    await leader.send({ flags: MessageFlags.IsComponentsV2, components: [leaderContainer] }).catch(err => console.log(`Failed to DM leader ${squadLeaderId}: ${err.message}`));

                    const rolesToRemove = SQUAD_OWNER_ROLES.filter(roleId => leader.roles.cache.has(roleId));
                    if (rolesToRemove.length > 0) {
                        await leader.roles.remove(rolesToRemove).catch(roleErr => {
                            if (roleErr.code !== 50013 && roleErr.code !== 10011) { console.log(`Failed to remove owner roles from leader ${leader.user.tag} (${squadLeaderId}):`, roleErr.message); }
                        });
                    }

                    try {
                        if (leader.nickname && leader.nickname.toUpperCase().startsWith(`[${squadNameToDisband}]`)) {
                            await leader.setNickname(leader.user.username);
                        }
                    } catch (nickError) {
                        if (nickError.code !== 50013) { console.log(`Could not reset nickname for leader ${leader.user.tag} (${squadLeaderId}):`, nickError.message); }
                    }

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

            const updatedSquadMembers = squadMembers.filter(row => row && row.length > 2 && row[2].toUpperCase() !== squadNameToDisband);
            const updatedSquadLeaders = squadLeaders.filter(row => row && row.length > 1 && row[1] !== squadLeaderId);
            const disbandedMemberIds = new Set(memberIdsToProcess);
            disbandedMemberIds.add(squadLeaderId);

            const updatedAllData = allData.map(row => {
                if (!row || row.length < 2) return row;
                const memberId = row[1];

                if (disbandedMemberIds.has(memberId)) {
                    const preference = row.length > 7 ? row[7] : '';
                    return [
                        row[0],
                        row[1],
                        'N/A',
                        'N/A',
                        'N/A',
                        'FALSE',
                        'No',
                        preference
                    ];
                } else {
                    const fullRow = Array(8).fill('');
                    for(let i = 0; i < Math.min(row.length, 8); i++) {
                        fullRow[i] = row[i] !== undefined && row[i] !== null ? row[i] : '';
                    }
                    return fullRow;
                }
            });


            await sheets.spreadsheets.values.clear({
                spreadsheetId: spreadsheetId,
                range: 'Squad Members!A:E'
            }).catch(err => console.error('Error clearing Squad Members:', err.response?.data || err.message));

            if (updatedSquadMembers.length > 0) {
                await sheets.spreadsheets.values.update({
                    spreadsheetId: spreadsheetId,
                    range: 'Squad Members!A1:E' + updatedSquadMembers.length,
                    valueInputOption: 'RAW',
                    resource: { values: updatedSquadMembers }
                }).catch(err => console.error('Error updating Squad Members:', err.response?.data || err.message));
            }

            await sheets.spreadsheets.values.clear({
                spreadsheetId: spreadsheetId,
                range: 'Squad Leaders!A:F'
            }).catch(err => console.error('Error clearing Squad Leaders:', err.response?.data || err.message));

            if (updatedSquadLeaders.length > 0) {
                await sheets.spreadsheets.values.update({
                    spreadsheetId: spreadsheetId,
                    range: 'Squad Leaders!A1:F' + updatedSquadLeaders.length,
                    valueInputOption: 'RAW',
                    resource: { values: updatedSquadLeaders }
                }).catch(err => console.error('Error updating Squad Leaders:', err.response?.data || err.message));
            }

            await sheets.spreadsheets.values.update({
                spreadsheetId: spreadsheetId,
                range: 'All Data!A:H',
                valueInputOption: 'RAW',
                resource: { values: updatedAllData }
            }).catch(err => console.error('Error updating All Data:', err.response?.data || err.message));

            const loggingChannel = await interaction.client.guilds.fetch('1233740086839869501')
                .then(guild => guild.channels.fetch('1233853415952748645'))
                .catch(() => null);

            if (loggingChannel) {
                try {
                    const logContainer = new ContainerBuilder();
                    logContainer.addTextDisplayComponents(
                        new TextDisplayBuilder().setContent('## Squad Force Disband\nModerator Action'),
                        new TextDisplayBuilder().setContent(`The squad **${squadNameToDisband}** was forcefully disbanded by moderator **${moderatorUserTag}** (${moderatorUserId}).`)
                    );
                    await loggingChannel.send({ flags: MessageFlags.IsComponentsV2, components: [logContainer] });
                } catch (logError) {
                    console.error('Failed to send log message:', logError);
                }
            }

            const successContainer = new ContainerBuilder();
            successContainer.addTextDisplayComponents(
                new TextDisplayBuilder().setContent('## Squad Forcefully Disbanded\nModerator Action'),
                new TextDisplayBuilder().setContent([
                    `The squad **${squadNameToDisband}** has been successfully disbanded.`,
                    'Members have been notified, roles removed, and nicknames reset (where possible), including mascot role (if assigned).'
                ].join('\n'))
            );

            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [successContainer], ephemeral: true });

        } catch (error) {
            console.error('Error during the force-disband command execution:', error);
            let errorMessage = 'An error occurred while forcefully disbanding the squad. Please try again later.';
            if (error.response?.data?.error) { errorMessage += ` (Details: ${error.response.data.error.message})`; }
            else if (error.message) { errorMessage += ` (Details: ${error.message})`; }
            const errorContainer = new ContainerBuilder();
            errorContainer.addTextDisplayComponents(
                new TextDisplayBuilder().setContent('## Force Disband Failed'),
                new TextDisplayBuilder().setContent(errorMessage)
            );
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer], ephemeral: true });
        }
    }
};
