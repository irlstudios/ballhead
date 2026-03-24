'use strict';

const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const { getSheetsClient, getCachedValues } = require('../../utils/sheets_cache');
const {
    SPREADSHEET_SQUADS, BALLHEAD_GUILD_ID, LOGGING_CHANNEL_ID,
    MODERATOR_ROLES, TOP_COMP_SQUAD_ROLE_ID, AD_PREFERENCE,
} = require('../../config/constants');
const { compSquadLevelRoles, findMascotByName } = require('../../config/squads');
const { buildNoticeContainer } = require('../../utils/ui');
const { getRolesToRemove, AD_SQUAD_NAME, AD_SQUAD_TYPE } = require('../../utils/squad_queries');
const { withSquadLock } = require('../../utils/squad_lock');
const logger = require('../../utils/logger');

const extendedCompRoles = [...compSquadLevelRoles, TOP_COMP_SQUAD_ROLE_ID];

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
            await withSquadLock(squadNameToDisband, async () => {
                const results = await getCachedValues({
                    sheets,
                    spreadsheetId: SPREADSHEET_SQUADS,
                    ranges: ['Squad Leaders!A:G', 'Squad Members!A:E', 'All Data!A:H'],
                    ttlMs: 5000,
                });
                const squadLeaders = (results.get('Squad Leaders!A:G') || []).slice(1);
                const squadMembers = (results.get('Squad Members!A:E') || []).slice(1);
                const allData = (results.get('All Data!A:H') || []).slice(1);

                const squadLeaderRow = squadLeaders.find(row => row && row.length > 2 && row[2]?.toUpperCase() === squadNameToDisband);
                if (!squadLeaderRow) {
                    const container = new ContainerBuilder();
                    container.addTextDisplayComponents(
                        new TextDisplayBuilder().setContent('## Squad Not Found'),
                        new TextDisplayBuilder().setContent(`Squad **${squadNameToDisband}** does not exist in the Squad Leaders sheet.`)
                    );
                    return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true });
                }

                const squadLeaderId = squadLeaderRow[1];

                // Determine squad type from All Data
                const squadTypeRow = allData.find(row => row && row.length > AD_SQUAD_TYPE && row[AD_SQUAD_NAME]?.toUpperCase() === squadNameToDisband);
                const squadType = squadTypeRow ? squadTypeRow[AD_SQUAD_TYPE] : null;
                const squadTypeRoles = squadType === 'Competitive' ? extendedCompRoles : [];

                const eventSquadName = squadLeaderRow[3];
                let mascotRoleIdToRemove = null;
                if (eventSquadName && eventSquadName !== 'N/A') {
                    const mascotInfo = findMascotByName(eventSquadName);
                    if (mascotInfo) mascotRoleIdToRemove = mascotInfo.roleId;
                }

                // Process squad members
                const squadMembersToProcess = squadMembers.filter(row => row && row.length > 2 && row[2]?.toUpperCase() === squadNameToDisband);
                const memberIdsToProcess = squadMembersToProcess.map(row => row[1]).filter(Boolean);

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

                            if (guildMember.nickname && guildMember.nickname.toUpperCase().startsWith(`[${squadNameToDisband}]`)) {
                                await guildMember.setNickname(guildMember.user.username).catch(nickError => {
                                    if (nickError.code !== 50013) logger.info(`Could not reset nickname for ${guildMember.user.tag}: ${nickError.message}`);
                                });
                            }

                            const rolesToRemove = [...squadTypeRoles];
                            if (mascotRoleIdToRemove) rolesToRemove.push(mascotRoleIdToRemove);
                            if (rolesToRemove.length > 0) {
                                await guildMember.roles.remove(rolesToRemove).catch(roleErr => {
                                    if (roleErr.code !== 50013 && roleErr.code !== 10011) {
                                        logger.info(`Failed to remove roles from ${guildMember.user.tag}: ${roleErr.message}`);
                                    }
                                });
                            }
                        }
                    } catch (fetchError) {
                        if (fetchError.code === 10007) logger.info(`Member ${memberId} not found in guild, skipping cleanup.`);
                        else logger.info(`Could not fetch member ${memberId}: ${fetchError.message}`);
                    }
                }

                // Process leader with role safety
                try {
                    const leader = await guild.members.fetch(squadLeaderId);
                    if (leader) {
                        const leaderContainer = new ContainerBuilder();
                        leaderContainer.addTextDisplayComponents(
                            new TextDisplayBuilder().setContent('## Your Squad Was Disbanded\nModerator Action'),
                            new TextDisplayBuilder().setContent(`Your squad **${squadNameToDisband}** has been forcefully disbanded by a moderator.`)
                        );
                        await leader.send({ flags: MessageFlags.IsComponentsV2, components: [leaderContainer] }).catch(err => logger.info(`Failed to DM leader ${squadLeaderId}: ${err.message}`));

                        // Role safety: only remove roles no longer needed
                        const safeRolesToRemove = getRolesToRemove(allData, squadLeaders, squadLeaderId, squadType, squadNameToDisband);
                        if (safeRolesToRemove.length > 0) {
                            await leader.roles.remove(safeRolesToRemove).catch(roleErr => {
                                if (roleErr.code !== 50013 && roleErr.code !== 10011) {
                                    logger.info(`Failed to remove owner roles from leader ${leader.user.tag}: ${roleErr.message}`);
                                }
                            });
                        }

                        if (leader.nickname && leader.nickname.toUpperCase().startsWith(`[${squadNameToDisband}]`)) {
                            await leader.setNickname(leader.user.username).catch(nickError => {
                                if (nickError.code !== 50013) logger.info(`Could not reset nickname for leader ${leader.user.tag}: ${nickError.message}`);
                            });
                        }

                        const leaderRolesToRemove = [...squadTypeRoles];
                        if (mascotRoleIdToRemove) leaderRolesToRemove.push(mascotRoleIdToRemove);
                        if (leaderRolesToRemove.length > 0) {
                            await leader.roles.remove(leaderRolesToRemove).catch(roleErr => {
                                if (roleErr.code !== 50013 && roleErr.code !== 10011) {
                                    logger.info(`Failed to remove level/mascot roles from leader ${leader.user.tag}: ${roleErr.message}`);
                                }
                            });
                        }
                    }
                } catch (fetchError) {
                    if (fetchError.code === 10007) logger.info(`Leader ${squadLeaderId} not found in guild, skipping cleanup.`);
                    else logger.info(`Could not fetch leader ${squadLeaderId}: ${fetchError.message}`);
                }

                // Update sheets - filter by squadName not userId
                const updatedSquadMembers = squadMembers.filter(row => !(row && row.length > 2 && row[2]?.toUpperCase() === squadNameToDisband));
                const updatedSquadLeaders = squadLeaders.filter(row => !(row && row.length > 2 && row[2]?.toUpperCase() === squadNameToDisband));

                const disbandedMemberIds = new Set(memberIdsToProcess);
                disbandedMemberIds.add(squadLeaderId);

                const updatedAllData = allData.map(row => {
                    if (!row || row.length < 2) return row;
                    const memberId = row[1];
                    const rowSquadName = row[AD_SQUAD_NAME];
                    if (disbandedMemberIds.has(memberId) && rowSquadName?.toUpperCase() === squadNameToDisband) {
                        const preference = row.length > AD_PREFERENCE ? row[AD_PREFERENCE] : '';
                        return [row[0], row[1], 'N/A', 'N/A', 'N/A', 'FALSE', 'No', preference];
                    }
                    const fullRow = Array(8).fill('');
                    for (let i = 0; i < Math.min(row.length, 8); i++) { fullRow[i] = row[i] ?? ''; }
                    return fullRow;
                });

                // Write back
                const sheetErrors = [];

                await sheets.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_SQUADS, range: 'Squad Members!A2:E' })
                    .catch(err => { sheetErrors.push('Squad Members clear'); logger.error('Error clearing Squad Members:', err.message); });
                if (updatedSquadMembers.length > 0) {
                    await sheets.spreadsheets.values.update({
                        spreadsheetId: SPREADSHEET_SQUADS, range: 'Squad Members!A2',
                        valueInputOption: 'RAW', resource: { values: updatedSquadMembers },
                    }).catch(err => { sheetErrors.push('Squad Members update'); logger.error('Error updating Squad Members:', err.message); });
                }

                await sheets.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_SQUADS, range: 'Squad Leaders!A2:G' })
                    .catch(err => { sheetErrors.push('Squad Leaders clear'); logger.error('Error clearing Squad Leaders:', err.message); });
                if (updatedSquadLeaders.length > 0) {
                    await sheets.spreadsheets.values.update({
                        spreadsheetId: SPREADSHEET_SQUADS, range: 'Squad Leaders!A2',
                        valueInputOption: 'RAW', resource: { values: updatedSquadLeaders },
                    }).catch(err => { sheetErrors.push('Squad Leaders update'); logger.error('Error updating Squad Leaders:', err.message); });
                }

                // Fetch headers for All Data rewrite
                const allDataHeaders = (await sheets.spreadsheets.values.get({
                    spreadsheetId: SPREADSHEET_SQUADS, range: 'All Data!A1:H1',
                }).catch(() => ({ data: { values: [] } }))).data.values || [];
                const headers = allDataHeaders[0] || [];

                await sheets.spreadsheets.values.update({
                    spreadsheetId: SPREADSHEET_SQUADS, range: 'All Data!A1:H',
                    valueInputOption: 'RAW', resource: { values: [headers, ...updatedAllData] },
                }).catch(err => { sheetErrors.push('All Data update'); logger.error('Error updating All Data:', err.message); });

                // Log
                const loggingChannel = await interaction.client.guilds.fetch(BALLHEAD_GUILD_ID)
                    .then(g => g.channels.fetch(LOGGING_CHANNEL_ID)).catch(() => null);
                if (loggingChannel) {
                    const logContainer = new ContainerBuilder();
                    logContainer.addTextDisplayComponents(
                        new TextDisplayBuilder().setContent('## Squad Force Disband\nModerator Action'),
                        new TextDisplayBuilder().setContent(`The squad **${squadNameToDisband}** was forcefully disbanded by moderator **${moderatorUserTag}** (${moderatorUserId}).`)
                    );
                    await loggingChannel.send({ flags: MessageFlags.IsComponentsV2, components: [logContainer] }).catch(err => logger.error('Failed to send log:', err));
                }

                if (sheetErrors.length > 0) {
                    const warnContainer = buildNoticeContainer({
                        title: 'Squad Partially Disbanded',
                        subtitle: 'Force Disband',
                        lines: [
                            `Squad **${squadNameToDisband}** was disbanded but some sheet updates failed: ${sheetErrors.join(', ')}.`,
                            'Please contact an admin to verify the data.',
                        ],
                    });
                    await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [warnContainer], ephemeral: true });
                } else {
                    const successContainer = new ContainerBuilder();
                    successContainer.addTextDisplayComponents(
                        new TextDisplayBuilder().setContent('## Squad Forcefully Disbanded\nModerator Action'),
                        new TextDisplayBuilder().setContent(`The squad **${squadNameToDisband}** has been successfully disbanded.\nMembers notified, roles removed, nicknames reset.`)
                    );
                    await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [successContainer], ephemeral: true });
                }
            });

        } catch (error) {
            logger.error('Error during the force-disband command execution:', error);
            const errorMessage = `An error occurred while forcefully disbanding the squad. ${error.message || 'Please try again later.'}`;
            const errorContainer = new ContainerBuilder();
            errorContainer.addTextDisplayComponents(
                new TextDisplayBuilder().setContent('## Force Disband Failed'),
                new TextDisplayBuilder().setContent(errorMessage)
            );
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer], ephemeral: true });
        }
    },
};
