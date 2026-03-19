const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const { getSheetsClient } = require('../../utils/sheets_cache');
const { SPREADSHEET_SQUADS, BALLHEAD_GUILD_ID, LOGGING_CHANNEL_ID, BOT_BUGS_CHANNEL_ID, SL_SQUAD_NAME, SL_EVENT_SQUAD, AD_ID } = require('../../config/constants');
const { compSquadLevelRoles, contentSquadLevelRoles, findMascotByName } = require('../../config/squads');
const logger = require('../../utils/logger');

const extendedCompRoles = [...compSquadLevelRoles, '1200889836844896316'];

const SL_ID = 1;
const SM_ID = 1;
const SM_SQUAD_NAME = 2;
const AD_SQUAD_TYPE = 3;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('remove-from-squad')
        .setDescription('Remove a member from your squad (Squad Leaders only).')
        .addUserOption(option =>
            option.setName('member')
                .setDescription('The member you want to remove from your squad.')
                .setRequired(true)),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const commandUserID = interaction.user.id;
        const commandUserTag = interaction.user.tag;
        const targetUser = interaction.options.getUser('member');
        const guild = interaction.guild;

        if (!targetUser) {
            const container = new ContainerBuilder();
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent('## User Not Found'),
                new TextDisplayBuilder().setContent('Could not find the specified user.')
            );
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true });
            return;
        }
        const targetUserID = targetUser.id;
        const targetUserTag = targetUser.tag;

        if (commandUserID === targetUserID) {
            const container = new ContainerBuilder();
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent('## Invalid Target'),
                new TextDisplayBuilder().setContent('You cannot remove yourself from your own squad.\nUse `/leave-squad` or `/disband-squad`.')
            );
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true });
            return;
        }
        if (targetUser.bot) {
            const container = new ContainerBuilder();
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent('## Invalid Target'),
                new TextDisplayBuilder().setContent('You cannot remove bots from squads.')
            );
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true });
            return;
        }

        const sheets = await getSheetsClient();

        try {
            const [allDataResponse, squadLeadersResponse, squadMembersResponse] = await Promise.all([
                sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_SQUADS, range: 'All Data!A:H' }),
                sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_SQUADS, range: 'Squad Leaders!A:F' }),
                sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_SQUADS, range: 'Squad Members!A:E' }),
            ]).catch(() => { throw new Error('Failed to retrieve data from Google Sheets.'); });

            const allData = (allDataResponse.data.values || []);
            const squadLeadersData = (squadLeadersResponse.data.values || []);
            const squadMembersData = (squadMembersResponse.data.values || []);

            allData.shift();
            squadLeadersData.shift();
            squadMembersData.shift();

            const leaderRow = squadLeadersData.find(row => row && row.length > SL_ID && row[SL_ID] === commandUserID);
            if (!leaderRow) {
                const container = new ContainerBuilder();
                container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('## Access Denied'),
                    new TextDisplayBuilder().setContent('You must be a squad leader to use this command.')
                );
                await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true });
                return;
            }
            const leaderSquadName = leaderRow[SL_SQUAD_NAME];
            if (!leaderSquadName || leaderSquadName === 'N/A') {
                const container = new ContainerBuilder();
                container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('## Squad Name Missing'),
                    new TextDisplayBuilder().setContent('Could not determine your squad name.')
                );
                await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true });
                return;
            }

            let targetMemberRowIndex = -1;
            const targetMemberRow = squadMembersData.find((row, index) => {
                if (row && row.length > SM_SQUAD_NAME && row[SM_ID] === targetUserID && row[SM_SQUAD_NAME] === leaderSquadName) {
                    targetMemberRowIndex = index;
                    return true;
                }
                return false;
            });

            if (!targetMemberRow || targetMemberRowIndex === -1) {
                const container = new ContainerBuilder();
                container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('## Member Not Found'),
                    new TextDisplayBuilder().setContent(`<@${targetUserID}> is not currently a member of your squad **${leaderSquadName}**.`)
                );
                await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true });
                return;
            }

            const leaderAllDataRow = allData.find(row => row && row.length > AD_ID && row[AD_ID] === commandUserID);
            const squadTypeForRoles = leaderAllDataRow ? leaderAllDataRow[AD_SQUAD_TYPE] : null;
            const squadTypeRolesToRemove = squadTypeForRoles === 'Competitive' ? extendedCompRoles :
                squadTypeForRoles === 'Content' ? contentSquadLevelRoles : [];

            const eventSquadName = leaderRow[SL_EVENT_SQUAD];
            let mascotRoleIdToRemove = null;
            if (eventSquadName && eventSquadName !== 'N/A') {
                const mascotInfo = findMascotByName(eventSquadName);
                if (mascotInfo) {
                    mascotRoleIdToRemove = mascotInfo.roleId;
                    logger.info(`Squad ${leaderSquadName} has mascot role: ${eventSquadName} (${mascotRoleIdToRemove})`);
                } else {
                    logger.warn(`Squad ${leaderSquadName} has event squad '${eventSquadName}' but no matching role ID found.`);
                }
            }


            const sheetRowIndexSM = targetMemberRowIndex + 2;
            const clearRangeSM = `Squad Members!A${sheetRowIndexSM}:E${sheetRowIndexSM}`;
            logger.info(`Clearing Squad Members range ${clearRangeSM} for user ${targetUserID}`);
            await sheets.spreadsheets.values.clear({
                spreadsheetId: SPREADSHEET_SQUADS,
                range: clearRangeSM,
            }).catch(err => { throw new Error(`Failed to clear row in Squad Members sheet: ${err.message}`); });

            let targetAllDataRowIndex = -1;
            allData.find((row, index) => {
                if (row && row.length > AD_ID && row[AD_ID] === targetUserID) {
                    targetAllDataRowIndex = index;
                    return true;
                }
                return false;
            });

            if (targetAllDataRowIndex !== -1) {
                const sheetRowIndexAD = targetAllDataRowIndex + 2;
                const rangeToUpdateAD = `All Data!C${sheetRowIndexAD}:G${sheetRowIndexAD}`;
                const valuesToUpdateAD = [['N/A', 'N/A', 'N/A', 'FALSE', 'No']];
                logger.info(`Updating All Data range ${rangeToUpdateAD} for user ${targetUserID}`);
                await sheets.spreadsheets.values.update({
                    spreadsheetId: SPREADSHEET_SQUADS,
                    range: rangeToUpdateAD,
                    valueInputOption: 'RAW',
                    resource: { values: valuesToUpdateAD },
                }).catch(err => { throw new Error(`Failed to update row in All Data sheet: ${err.message}`); });
            } else {
                logger.warn(`User ${targetUserTag} (${targetUserID}) was in Squad Members but not found in All Data.`);
            }
            logger.info(`Updated sheets for removing ${targetUserTag} from ${leaderSquadName}`);

            try {
                const memberToRemove = await guild.members.fetch(targetUserID);
                if (memberToRemove.nickname && memberToRemove.nickname.toUpperCase().startsWith(`[${leaderSquadName.toUpperCase()}]`)) {
                    logger.info(`Resetting nickname for ${targetUserTag}`);
                    await memberToRemove.setNickname(null).catch(nickErr => {
                        if (nickErr.code !== 50013) { logger.error(`Could not reset nickname for ${targetUserTag}: ${nickErr.message}`); }
                        else { logger.info(`Missing permissions to reset nickname for ${targetUserTag}.`); }
                    });
                }

                const rolesToRemove = [...squadTypeRolesToRemove];
                if (mascotRoleIdToRemove) {
                    rolesToRemove.push(mascotRoleIdToRemove);
                }

                if (rolesToRemove.length > 0) {
                    const rolesMemberHas = rolesToRemove.filter(roleId => memberToRemove.roles.cache.has(roleId));
                    if (rolesMemberHas.length > 0) {
                        logger.info(`Attempting to remove roles [${rolesMemberHas.join(', ')}] from ${targetUserTag}`);
                        await memberToRemove.roles.remove(rolesMemberHas).catch(roleErr => {
                            if (roleErr.code !== 50013 && roleErr.code !== 10011) {
                                logger.error(`Failed to remove roles from ${targetUserTag}: ${roleErr.message}`);
                            } else {
                                logger.info(`Missing permissions or roles already gone for ${targetUserTag}.`);
                            }
                        });
                    } else {
                        logger.info(`${targetUserTag} did not have any relevant roles to remove.`);
                    }
                }

            } catch (discordError) {
                if (discordError.code === 10007) {
                    logger.info(`Member ${targetUserTag} (${targetUserID}) left the server before nickname/roles could be updated.`);
                } else {
                    logger.error(`Error updating Discord member ${targetUserTag}: ${discordError.message}`);
                }
                const warningContainer = new ContainerBuilder();
                warningContainer.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('## Partial Cleanup'),
                    new TextDisplayBuilder().setContent(`Could not reset nickname or remove roles for ${targetUserTag}.\nThey may have left the server.`)
                );
                await interaction.followUp({ flags: MessageFlags.IsComponentsV2, components: [warningContainer], ephemeral: true }).catch(followUpError => {
                    logger.error('Failed to send follow-up warning after remove-from-squad:', followUpError);
                });
            }

            try {
                const loggingGuild = await interaction.client.guilds.fetch(BALLHEAD_GUILD_ID);
                const loggingChannel = await loggingGuild.channels.fetch(LOGGING_CHANNEL_ID);
                const logContainer = new ContainerBuilder();
                logContainer.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('## Member Removed'),
                    new TextDisplayBuilder().setContent(`**${commandUserTag}** (<@${commandUserID}>) removed **${targetUserTag}** (<@${targetUserID}>) from squad **${leaderSquadName}**.`)
                );
                await loggingChannel.send({ flags: MessageFlags.IsComponentsV2, components: [logContainer] });
            } catch (logError) {
                logger.error('Failed to send removal log message:', logError);
            }

            const successContainer = new ContainerBuilder();
            successContainer.addTextDisplayComponents(
                new TextDisplayBuilder().setContent('## Member Removed'),
                new TextDisplayBuilder().setContent([
                    `<@${targetUserID}> has been successfully removed from **${leaderSquadName}**.`,
                    'Their roles and nickname have been reset.'
                ].join('\n'))
            );
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [successContainer], ephemeral: true });

        } catch (error) {
            logger.error(`Error during /remove-from-squad for ${commandUserTag} removing ${targetUserTag}:`, error);
            try {
                const errorGuild = await interaction.client.guilds.fetch(BALLHEAD_GUILD_ID);
                const errorChannel = await errorGuild.channels.fetch(BOT_BUGS_CHANNEL_ID);
                const errorContainer = new ContainerBuilder();
                errorContainer.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('## Remove From Squad Error'),
                    new TextDisplayBuilder().setContent(`**User:** ${commandUserTag} (${commandUserID})\n**Target:** ${targetUserTag} (${targetUserID})\n**Error:** ${error.message}`)
                );
                await errorChannel.send({ flags: MessageFlags.IsComponentsV2, components: [errorContainer] });
            } catch (logError) {
                logger.error('Failed to log removal command error:', logError);
            }
            const replyContainer = new ContainerBuilder();
            replyContainer.addTextDisplayComponents(
                new TextDisplayBuilder().setContent('## Request Failed'),
                new TextDisplayBuilder().setContent(`An error occurred: ${error.message || 'Please try again later.'}`)
            );
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [replyContainer], ephemeral: true }).catch(err => logger.error('Failed to edit reply:', err));
        }
    }
};
