const { SlashCommandBuilder, MessageFlags, ContainerBuilder } = require('discord.js');
const { getSheetsClient } = require('../../utils/sheets_cache');
const { SPREADSHEET_SQUADS, BALLHEAD_GUILD_ID, LOGGING_CHANNEL_ID, SQUAD_OWNER_ROLES, SL_SQUAD_NAME, SL_EVENT_SQUAD, AD_PREFERENCE } = require('../../config/constants');
const { compSquadLevelRoles, contentSquadLevelRoles, findMascotByName } = require('../../config/squads');
const { buildTextBlock, buildNoticeContainer } = require('../../utils/ui');
const logger = require('../../utils/logger');

const SL_ID = 1;
const AD_SQUAD_NAME = 2;
const AD_SQUAD_TYPE = 3;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('disband-squad')
        .setDescription('Disband your squad if you are the squad leader.'),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const userId = interaction.user.id;
        const userTag = interaction.user.tag;
        const guild = interaction.guild;
        const sheets = await getSheetsClient();

        try {
            const [squadLeadersResponse, squadMembersResponse, allDataResponse] = await Promise.all([
                sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_SQUADS, range: 'Squad Leaders!A:F' }),
                sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_SQUADS, range: 'Squad Members!A:E' }),
                sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_SQUADS, range: 'All Data!A:H' })
            ]).catch(() => { throw new Error('Failed to retrieve data from Google Sheets.'); });

            const squadLeaders = (squadLeadersResponse.data.values || []).slice(1);
            const squadMembers = (squadMembersResponse.data.values || []).slice(1);
            const allData = (allDataResponse.data.values || []).slice(1);

            const userSquadLeaderRow = squadLeaders.find(row => row && row.length > SL_ID && row[SL_ID] === userId);
            if (!userSquadLeaderRow) {
                const infoContainer = buildNoticeContainer({
                    title: 'No Squad Owned',
                    subtitle: 'Disband Squad',
                    lines: ['You do not own a squad, so you cannot disband one.']
                });
                return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [infoContainer], ephemeral: true });
            }
            const squadName = userSquadLeaderRow[SL_SQUAD_NAME];
            if (!squadName || squadName === 'N/A') {
                const errorContainer = buildNoticeContainer({
                    title: 'Squad Name Missing',
                    subtitle: 'Disband Squad',
                    lines: ['Could not determine your squad name.']
                });
                return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer], ephemeral: true });
            }

            const squadTypeRow = allData.find(row => row && row.length > AD_SQUAD_TYPE && row[AD_SQUAD_NAME] === squadName);
            const squadTypeForRoles = squadTypeRow ? squadTypeRow[AD_SQUAD_TYPE] : null;
            const squadTypeRolesToRemove = squadTypeForRoles === 'Competitive' ? compSquadLevelRoles :
                squadTypeForRoles === 'Content' ? contentSquadLevelRoles : [];

            const eventSquadName = userSquadLeaderRow[SL_EVENT_SQUAD];
            let mascotRoleIdToRemove = null;
            if (eventSquadName && eventSquadName !== 'N/A') {
                const mascotInfo = findMascotByName(eventSquadName);
                if (mascotInfo) {
                    mascotRoleIdToRemove = mascotInfo.roleId;
                    logger.info(`Squad ${squadName} identified with mascot role: ${eventSquadName} (${mascotRoleIdToRemove})`);
                } else {
                    logger.warn(`Squad ${squadName} has event squad '${eventSquadName}' but no matching role ID found.`);
                }
            }

            const squadMembersToProcess = squadMembers.filter(row => row && row.length > 2 && row[2] === squadName);
            const memberIdsToProcess = squadMembersToProcess.map(row => row[1]);

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
                                if (nickError.code !== 50013) { logger.info(`Could not reset nickname for ${member.user.tag} (${memberId}): ${nickError.message}`); }
                            });
                        }

                        const rolesToRemoveFromMember = [...squadTypeRolesToRemove];
                        if (mascotRoleIdToRemove) {
                            rolesToRemoveFromMember.push(mascotRoleIdToRemove);
                        }
                        if (rolesToRemoveFromMember.length > 0) {
                            logger.info(`Attempting to remove roles [${rolesToRemoveFromMember.join(', ')}] from member ${member.user.tag}`);
                            await member.roles.remove(rolesToRemoveFromMember).catch(roleErr => {
                                if (roleErr.code !== 50013 && roleErr.code !== 10011 ) {
                                    logger.info(`Failed to remove roles from ${member.user.tag} (${memberId}): ${roleErr.message}`);
                                }
                            });
                        }
                    }
                } catch (fetchError) { /* ... handle member fetch error ... */
                    if (fetchError.code === 10007) { logger.info(`Member ${memberId} not found in guild, skipping cleanup.`); }
                    else { logger.info(`Could not fetch member ${memberId} for cleanup: ${fetchError.message}`); }
                }
            }

            try {
                const leader = await guild.members.fetch(userId);
                if (leader) {
                    const ownerRolesToRemove = SQUAD_OWNER_ROLES.filter(roleId => leader.roles.cache.has(roleId));
                    if (ownerRolesToRemove.length > 0) {
                        await leader.roles.remove(ownerRolesToRemove).catch(roleErr => { /* ... error handling ... */
                            if (roleErr.code !== 50013 && roleErr.code !== 10011) { logger.info(`Failed to remove owner roles from leader ${leader.user.tag}: ${roleErr.message}`); }
                        });
                    }

                    if (leader.nickname && leader.nickname.toUpperCase().startsWith(`[${squadName}]`)) {
                        await leader.setNickname(leader.user.username).catch(nickError => { /* ... error handling ... */
                            if (nickError.code !== 50013) { logger.info(`Could not reset nickname for leader ${leader.user.tag}: ${nickError.message}`); }
                        });
                    }

                    const rolesToRemoveFromLeader = [...squadTypeRolesToRemove];
                    if (mascotRoleIdToRemove) {
                        rolesToRemoveFromLeader.push(mascotRoleIdToRemove);
                    }
                    if (rolesToRemoveFromLeader.length > 0) {
                        logger.info(`Attempting to remove roles [${rolesToRemoveFromLeader.join(', ')}] from leader ${leader.user.tag}`);
                        await leader.roles.remove(rolesToRemoveFromLeader).catch(roleErr => { /* ... error handling ... */
                            if (roleErr.code !== 50013 && roleErr.code !== 10011) { logger.info(`Failed to remove level/mascot roles from leader ${leader.user.tag}: ${roleErr.message}`); }
                        });
                    }
                }
            } catch (fetchError) { /* ... handle leader fetch error ... */
                if (fetchError.code === 10007) { logger.info(`Leader ${userId} not found in guild, skipping cleanup.`); }
                else { logger.info(`Could not fetch leader ${userId} for cleanup: ${fetchError.message}`); }
            }

            const updatedSquadMembers = squadMembers.filter(row => row && row.length > 2 && row[2] !== squadName);
            const updatedSquadLeaders = squadLeaders.filter(row => row && row.length > 1 && row[1] !== userId);
            const disbandedMemberIds = new Set(memberIdsToProcess);
            disbandedMemberIds.add(userId);

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

            const finalAllData = [allDataResponse.data.values[0], ...updatedAllData];

            const sheetErrors = [];
            await sheets.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_SQUADS, range: 'Squad Members!A2:E' }).catch(err => { sheetErrors.push('Squad Members clear'); logger.error('Error clearing Squad Members:', err.response?.data || err.message); });
            if (updatedSquadMembers.length > 0) {
                await sheets.spreadsheets.values.update({ spreadsheetId: SPREADSHEET_SQUADS, range: 'Squad Members!A2', valueInputOption: 'RAW', resource: { values: updatedSquadMembers } }).catch(err => { sheetErrors.push('Squad Members update'); logger.error('Error updating Squad Members:', err.response?.data || err.message); });
            }
            await sheets.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_SQUADS, range: 'Squad Leaders!A2:F' }).catch(err => { sheetErrors.push('Squad Leaders clear'); logger.error('Error clearing Squad Leaders:', err.response?.data || err.message); });
            if (updatedSquadLeaders.length > 0) {
                await sheets.spreadsheets.values.update({ spreadsheetId: SPREADSHEET_SQUADS, range: 'Squad Leaders!A2', valueInputOption: 'RAW', resource: { values: updatedSquadLeaders } }).catch(err => { sheetErrors.push('Squad Leaders update'); logger.error('Error updating Squad Leaders:', err.response?.data || err.message); });
            }
            await sheets.spreadsheets.values.update({ spreadsheetId: SPREADSHEET_SQUADS, range: 'All Data!A1:H', valueInputOption: 'RAW', resource: { values: finalAllData } }).catch(err => { sheetErrors.push('All Data update'); logger.error('Error updating All Data:', err.response?.data || err.message); });


            const loggingChannel = await interaction.client.guilds.fetch(BALLHEAD_GUILD_ID) /* ... */ .then(guild => guild?.channels.fetch(LOGGING_CHANNEL_ID)).catch(() => null);
            if (loggingChannel) { /* ... send log message ... */
                try {
                    const logContainer = new ContainerBuilder();
                    const block = buildTextBlock({ title: 'Squad Disbanded', subtitle: 'Moderator Log', lines: [`The squad **${squadName}** was disbanded by **${userTag}** (${userId }).`] });
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
                        'Please contact an admin to verify the data.'
                    ]
                });
                await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [warnContainer], ephemeral: true });
            } else {
                const successContainer = new ContainerBuilder();
                const block = buildTextBlock({ title: 'Squad Disbanded', subtitle: 'Disband Squad', lines: [
                    `Your squad **${squadName}** has been successfully disbanded.`,
                    'Members have been notified, roles removed (including squad level and mascot roles), and nicknames reset (where possible).'
                ] });
                if (block) successContainer.addTextDisplayComponents(block);
                await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [successContainer], ephemeral: true });
            }

        } catch (error) {
            logger.error('Error during the disband-squad command execution:', error);
            let errorMessage = 'An error occurred while disbanding the squad. Please try again later.';
            if (error.response?.data?.error) { errorMessage += ` (Details: ${error.response.data.error.message})`; } else if (error.message) { errorMessage += ` (Details: ${error.message})`; }
            const errorContainer = buildNoticeContainer({
                title: 'Disband Failed',
                subtitle: 'Disband Squad',
                lines: [errorMessage]
            });
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer], ephemeral: true }).catch(err => logger.error('Failed to edit reply:', err));
        }
    }
};
