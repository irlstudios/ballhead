'use strict';

const { SlashCommandBuilder, MessageFlags, ContainerBuilder } = require('discord.js');
const { getSheetsClient, getCachedValues } = require('../../utils/sheets_cache');
const {
    SPREADSHEET_SQUADS, GYM_CLASS_GUILD_ID, LOGGING_CHANNEL_ID,
    AD_PREFERENCE,
} = require('../../config/constants');
const { compSquadLevelRoles, findMascotByName } = require('../../config/squads');
const { buildTextBlock, buildNoticeContainer } = require('../../utils/ui');
const { disambiguateSquad, getRolesToRemove, AD_SQUAD_NAME, AD_SQUAD_TYPE, SL_SQUAD_NAME } = require('../../utils/squad_queries');
const { withSquadLock } = require('../../utils/squad_lock');
const { stripLevelRoles } = require('../../utils/squad_level_sync');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('disband-squad')
        .setDescription('Disband your squad if you are the squad leader.')
        .addStringOption(opt =>
            opt.setName('squad')
                .setDescription('Squad name (required if you own multiple)')
                .setRequired(false)
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const userId = interaction.user.id;
        const userTag = interaction.user.tag;
        const guild = interaction.guild;
        const sheets = await getSheetsClient();

        try {
            const results = await getCachedValues({
                sheets,
                spreadsheetId: SPREADSHEET_SQUADS,
                ranges: ['Squad Leaders!A:G', 'Squad Members!A:E', 'All Data!A:H'],
                ttlMs: 30000,
            });
            const squadLeaders = (results.get('Squad Leaders!A:G') || []).slice(1);
            const squadMembers = (results.get('Squad Members!A:E') || []).slice(1);
            const allData = (results.get('All Data!A:H') || []).slice(1);

            const specifiedSquad = interaction.options.getString('squad');
            const { squad, error } = disambiguateSquad(squadLeaders, userId, specifiedSquad);
            if (error) {
                const infoContainer = buildNoticeContainer({
                    title: 'Disband Squad',
                    subtitle: 'Squad Selection',
                    lines: [error],
                });
                return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [infoContainer], ephemeral: true });
            }

            const squadName = squad[SL_SQUAD_NAME];
            if (!squadName || squadName === 'N/A') {
                const errorContainer = buildNoticeContainer({
                    title: 'Squad Name Missing',
                    subtitle: 'Disband Squad',
                    lines: ['Could not determine your squad name.'],
                });
                return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer], ephemeral: true });
            }

            await withSquadLock(squadName, async () => {
                // Determine squad type from All Data
                const squadTypeRow = allData.find(row => row && row.length > AD_SQUAD_TYPE && row[AD_SQUAD_NAME]?.toUpperCase() === squadName.toUpperCase());
                const squadType = squadTypeRow ? squadTypeRow[AD_SQUAD_TYPE] : null;
                const squadTypeRolesToRemove = squadType === 'Competitive' ? [...compSquadLevelRoles] : [];

                const eventSquadName = squad[3]; // SL_EVENT_SQUAD
                let mascotRoleIdToRemove = null;
                if (eventSquadName && eventSquadName !== 'N/A') {
                    const mascotInfo = findMascotByName(eventSquadName);
                    if (mascotInfo) {
                        mascotRoleIdToRemove = mascotInfo.roleId;
                    }
                }

                // Process squad members
                const squadMembersToProcess = squadMembers.filter(row => row && row.length > 2 && row[2]?.toUpperCase() === squadName.toUpperCase());
                const memberIdsToProcess = squadMembersToProcess.map(row => row[1]).filter(Boolean);

                for (const memberRow of squadMembersToProcess) {
                    const memberId = memberRow[1];
                    if (!memberId) continue;
                    try {
                        const member = await guild.members.fetch(memberId);
                        if (member) {
                            const dmContainer = new ContainerBuilder();
                            const block = buildTextBlock({ title: 'Squad Disbanded', subtitle: 'Squad Update', lines: [`The squad **${squadName}** you were in has been disbanded by the squad leader.`] });
                            if (block) dmContainer.addTextDisplayComponents(block);
                            await member.send({ flags: MessageFlags.IsComponentsV2, components: [dmContainer] }).catch(err => logger.info(`Failed to DM ${memberId}: ${err.message}`));

                            if (member.nickname && member.nickname.toUpperCase().startsWith(`[${squadName}]`)) {
                                await member.setNickname(member.user.username).catch(nickError => {
                                    if (nickError.code !== 50013) logger.info(`Could not reset nickname for ${member.user.tag}: ${nickError.message}`);
                                });
                            }

                            const rolesToRemove = [...squadTypeRolesToRemove];
                            if (mascotRoleIdToRemove) rolesToRemove.push(mascotRoleIdToRemove);
                            if (rolesToRemove.length > 0) {
                                await member.roles.remove(rolesToRemove).catch(roleErr => {
                                    if (roleErr.code !== 50013 && roleErr.code !== 10011) {
                                        logger.info(`Failed to remove roles from ${member.user.tag}: ${roleErr.message}`);
                                    }
                                });
                            }
                        }
                    } catch (fetchError) {
                        if (fetchError.code === 10007) logger.info(`Member ${memberId} not found in guild, skipping cleanup.`);
                        else logger.info(`Could not fetch member ${memberId} for cleanup: ${fetchError.message}`);
                    }
                }

                // Process leader role removal with safety (check remaining squads)
                try {
                    const leader = await guild.members.fetch(userId);
                    if (leader) {
                        // Use role safety: only remove roles the user no longer needs
                        const rolesToRemove = getRolesToRemove(allData, squadLeaders, userId, squadType, squadName);
                        if (rolesToRemove.length > 0) {
                            await leader.roles.remove(rolesToRemove).catch(roleErr => {
                                if (roleErr.code !== 50013 && roleErr.code !== 10011) {
                                    logger.info(`Failed to remove owner roles from leader ${leader.user.tag}: ${roleErr.message}`);
                                }
                            });
                        }

                        if (leader.nickname && leader.nickname.toUpperCase().startsWith(`[${squadName}]`)) {
                            await leader.setNickname(leader.user.username).catch(nickError => {
                                if (nickError.code !== 50013) logger.info(`Could not reset nickname for leader ${leader.user.tag}: ${nickError.message}`);
                            });
                        }

                        // Remove level + mascot roles from leader
                        const leaderRolesToRemove = [...squadTypeRolesToRemove];
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
                    if (fetchError.code === 10007) logger.info(`Leader ${userId} not found in guild, skipping cleanup.`);
                    else logger.info(`Could not fetch leader ${userId} for cleanup: ${fetchError.message}`);
                }

                // Update sheets: filter by squadName, not userId
                const updatedSquadMembers = squadMembers.filter(row => !(row && row.length > 2 && row[2]?.toUpperCase() === squadName.toUpperCase()));
                const updatedSquadLeaders = squadLeaders.filter(row => !(row && row.length > 2 && row[2]?.toUpperCase() === squadName.toUpperCase()));

                // Update All Data: clear squad info for affected members
                const disbandedMemberIds = new Set(memberIdsToProcess);
                disbandedMemberIds.add(userId);

                const updatedAllData = allData.map(row => {
                    if (!row || row.length < 2) return row;
                    const memberId = row[1];
                    const rowSquadName = row[AD_SQUAD_NAME];
                    // Only clear rows that match this specific squad
                    if (disbandedMemberIds.has(memberId) && rowSquadName?.toUpperCase() === squadName.toUpperCase()) {
                        const preference = row.length > AD_PREFERENCE ? row[AD_PREFERENCE] : '';
                        return [row[0], row[1], 'N/A', 'N/A', 'N/A', 'FALSE', 'No', preference];
                    }
                    const fullRow = Array(8).fill('');
                    for (let i = 0; i < Math.min(row.length, 8); i++) { fullRow[i] = row[i] ?? ''; }
                    return fullRow;
                });

                // Write back to sheets
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

                // Re-fetch headers for full rewrite of All Data
                const allDataFull = (await sheets.spreadsheets.values.get({
                    spreadsheetId: SPREADSHEET_SQUADS, range: 'All Data!A1:H1',
                }).catch(() => ({ data: { values: [] } }))).data.values || [];
                const headers = allDataFull[0] || [];

                await sheets.spreadsheets.values.update({
                    spreadsheetId: SPREADSHEET_SQUADS, range: 'All Data!A1:H',
                    valueInputOption: 'RAW', resource: { values: [headers, ...updatedAllData] },
                }).catch(err => { sheetErrors.push('All Data update'); logger.error('Error updating All Data:', err.message); });

                // Log the disband
                const loggingChannel = await interaction.client.guilds.fetch(GYM_CLASS_GUILD_ID)
                    .then(g => g?.channels.fetch(LOGGING_CHANNEL_ID)).catch(() => null);
                if (loggingChannel) {
                    try {
                        const logContainer = new ContainerBuilder();
                        const block = buildTextBlock({ title: 'Squad Disbanded', subtitle: 'Moderator Log', lines: [`The squad **${squadName}** was disbanded by **${userTag}** (${userId}).`] });
                        if (block) logContainer.addTextDisplayComponents(block);
                        await loggingChannel.send({ flags: MessageFlags.IsComponentsV2, components: [logContainer] });
                    } catch (logError) {
                        logger.error('Failed to send log message:', logError);
                    }
                }

                if (sheetErrors.length > 0) {
                    const warnContainer = buildNoticeContainer({
                        title: 'Squad Partially Disbanded',
                        subtitle: 'Disband Squad',
                        lines: [
                            `Squad **${squadName}** was disbanded but some sheet updates failed: ${sheetErrors.join(', ')}.`,
                            'Please contact an admin to verify the data.',
                        ],
                    });
                    await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [warnContainer], ephemeral: true });
                } else {
                    const successContainer = new ContainerBuilder();
                    const block = buildTextBlock({
                        title: 'Squad Disbanded',
                        subtitle: 'Disband Squad',
                        lines: [
                            `Your squad **${squadName}** has been successfully disbanded.`,
                            'Members have been notified, roles removed, and nicknames reset (where possible).',
                        ],
                    });
                    if (block) successContainer.addTextDisplayComponents(block);
                    await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [successContainer], ephemeral: true });
                }
            });

        } catch (error) {
            logger.error('Error during the disband-squad command execution:', error);
            const errorMessage = `An error occurred while disbanding the squad. ${error.message || 'Please try again later.'}`;
            const errorContainer = buildNoticeContainer({
                title: 'Disband Failed',
                subtitle: 'Disband Squad',
                lines: [errorMessage],
            });
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer], ephemeral: true }).catch(err => logger.error('Failed to edit reply:', err));
        }
    },
};
