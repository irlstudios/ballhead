const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const { getSheetsClient } = require('../../utils/sheets_cache');
const { SPREADSHEET_SQUADS, BALLHEAD_GUILD_ID, LOGGING_CHANNEL_ID, SQUAD_OWNER_ROLES, MODERATOR_ROLES } = require('../../config/constants');
const { compSquadLevelRoles, contentSquadLevelRoles, findMascotByName } = require('../../config/squads');
const { buildNoticeContainer } = require('../../utils/ui');
const logger = require('../../utils/logger');

const extendedCompRoles = [...compSquadLevelRoles, '1200889836844896316'];

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

        try {
            const squadLeadersResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_SQUADS,
                range: 'Squad Leaders!A:F'
            });
            const squadMembersResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_SQUADS,
                range: 'Squad Members!A:E'
            });
            const allDataResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_SQUADS,
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
            const squadTypeRoles = squadTypeForRoles === 'Competitive' ? extendedCompRoles :
                squadTypeForRoles === 'Content' ? contentSquadLevelRoles : [];

            const eventSquadName = squadLeaderRow[3];
            let mascotRoleIdToRemove = null;
            if (eventSquadName && eventSquadName !== 'N/A') {
                const mascotInfo = findMascotByName(eventSquadName);
                if (mascotInfo) {
                    mascotRoleIdToRemove = mascotInfo.roleId;
                    logger.info(`Squad ${squadNameToDisband} has mascot role: ${eventSquadName} (${mascotRoleIdToRemove})`);
                } else {
                    logger.warn(`Squad ${squadNameToDisband} has event squad '${eventSquadName}' but no matching role ID found.`);
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
                        await guildMember.send({ flags: MessageFlags.IsComponentsV2, components: [dmContainer] }).catch(err => logger.info(`Failed to DM ${memberId}: ${err.message}`));

                        try {
                            if (guildMember.nickname && guildMember.nickname.toUpperCase().startsWith(`[${squadNameToDisband}]`)) {
                                await guildMember.setNickname(guildMember.user.username);
                            }
                        } catch (nickError) {
                            if (nickError.code !== 50013) { logger.info(`Could not reset nickname for ${guildMember.user.tag} (${memberId}): ${nickError.message}`); }
                        }

                        const rolesToRemoveFromMember = [...squadTypeRoles];
                        if (mascotRoleIdToRemove) {
                            rolesToRemoveFromMember.push(mascotRoleIdToRemove);
                        }
                        if (rolesToRemoveFromMember.length > 0) {
                            await guildMember.roles.remove(rolesToRemoveFromMember).catch(roleErr => {
                                if (roleErr.code !== 50013 && roleErr.code !== 10011 ) { logger.info(`Failed to remove roles from ${guildMember.user.tag} (${memberId}): ${roleErr.message}`); }
                            });
                        }

                    }
                } catch (fetchError) {
                    if (fetchError.code === 10007) { logger.info(`Member ${memberId} not found in guild, skipping cleanup.`); }
                    else { logger.info(`Could not fetch member ${memberId} for cleanup: ${fetchError.message}`); }
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
                    await leader.send({ flags: MessageFlags.IsComponentsV2, components: [leaderContainer] }).catch(err => logger.info(`Failed to DM leader ${squadLeaderId}: ${err.message}`));

                    const rolesToRemove = SQUAD_OWNER_ROLES.filter(roleId => leader.roles.cache.has(roleId));
                    if (rolesToRemove.length > 0) {
                        await leader.roles.remove(rolesToRemove).catch(roleErr => {
                            if (roleErr.code !== 50013 && roleErr.code !== 10011) { logger.info(`Failed to remove owner roles from leader ${leader.user.tag} (${squadLeaderId}): ${roleErr.message}`); }
                        });
                    }

                    try {
                        if (leader.nickname && leader.nickname.toUpperCase().startsWith(`[${squadNameToDisband}]`)) {
                            await leader.setNickname(leader.user.username);
                        }
                    } catch (nickError) {
                        if (nickError.code !== 50013) { logger.info(`Could not reset nickname for leader ${leader.user.tag} (${squadLeaderId}): ${nickError.message}`); }
                    }

                    const rolesToRemoveFromLeader = [...squadTypeRoles];
                    if (mascotRoleIdToRemove) {
                        rolesToRemoveFromLeader.push(mascotRoleIdToRemove);
                    }

                    if (rolesToRemoveFromLeader.length > 0) {
                        logger.info(`Attempting to remove roles [${rolesToRemoveFromLeader.join(', ')}] from leader ${leader.user.tag}`);
                        await leader.roles.remove(rolesToRemoveFromLeader).catch(roleErr => {
                            if (roleErr.code !== 50013 && roleErr.code !== 10011) { logger.info(`Failed to remove squad level/mascot roles from leader ${leader.user.tag}: ${roleErr.message}`); }
                        });
                    }
                }
            } catch (fetchError) {
                if (fetchError.code === 10007) { logger.info(`Leader ${squadLeaderId} not found in guild, skipping cleanup.`); }
                else { logger.info(`Could not fetch leader ${squadLeaderId} for cleanup: ${fetchError.message}`); }
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


            const sheetErrors = [];
            await sheets.spreadsheets.values.clear({
                spreadsheetId: SPREADSHEET_SQUADS,
                range: 'Squad Members!A:E'
            }).catch(err => { sheetErrors.push('Squad Members clear'); logger.error('Error clearing Squad Members:', err.response?.data || err.message); });

            if (updatedSquadMembers.length > 0) {
                await sheets.spreadsheets.values.update({
                    spreadsheetId: SPREADSHEET_SQUADS,
                    range: 'Squad Members!A1:E' + updatedSquadMembers.length,
                    valueInputOption: 'RAW',
                    resource: { values: updatedSquadMembers }
                }).catch(err => { sheetErrors.push('Squad Members update'); logger.error('Error updating Squad Members:', err.response?.data || err.message); });
            }

            await sheets.spreadsheets.values.clear({
                spreadsheetId: SPREADSHEET_SQUADS,
                range: 'Squad Leaders!A:F'
            }).catch(err => { sheetErrors.push('Squad Leaders clear'); logger.error('Error clearing Squad Leaders:', err.response?.data || err.message); });

            if (updatedSquadLeaders.length > 0) {
                await sheets.spreadsheets.values.update({
                    spreadsheetId: SPREADSHEET_SQUADS,
                    range: 'Squad Leaders!A1:F' + updatedSquadLeaders.length,
                    valueInputOption: 'RAW',
                    resource: { values: updatedSquadLeaders }
                }).catch(err => { sheetErrors.push('Squad Leaders update'); logger.error('Error updating Squad Leaders:', err.response?.data || err.message); });
            }

            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_SQUADS,
                range: 'All Data!A:H',
                valueInputOption: 'RAW',
                resource: { values: updatedAllData }
            }).catch(err => { sheetErrors.push('All Data update'); logger.error('Error updating All Data:', err.response?.data || err.message); });

            const loggingChannel = await interaction.client.guilds.fetch(BALLHEAD_GUILD_ID)
                .then(guild => guild.channels.fetch(LOGGING_CHANNEL_ID))
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
                    logger.error('Failed to send log message:', logError);
                }
            }

            if (sheetErrors.length > 0) {
                const warnContainer = buildNoticeContainer({
                    title: 'Squad Partially Disbanded',
                    subtitle: 'Force Disband',
                    lines: [
                        `Squad **${squadNameToDisband}** was disbanded but some sheet updates failed: ${sheetErrors.join(', ')}.`,
                        'Please contact an admin to verify the data.'
                    ]
                });
                await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [warnContainer], ephemeral: true });
            } else {
                const successContainer = new ContainerBuilder();
                successContainer.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('## Squad Forcefully Disbanded\nModerator Action'),
                    new TextDisplayBuilder().setContent([
                        `The squad **${squadNameToDisband}** has been successfully disbanded.`,
                        'Members have been notified, roles removed, and nicknames reset (where possible), including mascot role (if assigned).'
                    ].join('\n'))
                );
                await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [successContainer], ephemeral: true });
            }

        } catch (error) {
            logger.error('Error during the force-disband command execution:', error);
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
