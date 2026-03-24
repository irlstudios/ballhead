const { SlashCommandBuilder, MessageFlags, ContainerBuilder } = require('discord.js');
const { getSheetsClient } = require('../../utils/sheets_cache');
const { SPREADSHEET_SQUADS, GYM_CLASS_GUILD_ID, BALLHEAD_GUILD_ID, LOGGING_CHANNEL_ID, BOT_BUGS_CHANNEL_ID, SL_SQUAD_NAME, SL_EVENT_SQUAD, AD_ID } = require('../../config/constants');
const { findMascotByName } = require('../../config/squads');
const { buildTextBlock, buildNoticeContainer } = require('../../utils/ui');
const { stripLevelRoles } = require('../../utils/squad_level_sync');
const logger = require('../../utils/logger');

const SL_ID = 1;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leave-squad')
        .setDescription('Leave your current squad'),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const userId = interaction.user.id;
        const userTag = interaction.user.tag;
        const member = interaction.member;
        const guild = interaction.guild;

        if (!member || !guild) {
            const errorContainer = buildNoticeContainer({
                title: 'Server Info Missing',
                subtitle: 'Leave Squad',
                lines: ['Could not retrieve necessary server information.']
            });
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer], ephemeral: true });
            return;
        }

        const sheets = await getSheetsClient();

        try {
            const [squadMembersResponse, squadLeadersResponse, allDataResponse] = await Promise.all([
                sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_SQUADS, range: 'Squad Members!A:E' }),
                sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_SQUADS, range: 'Squad Leaders!A:G' }),
                sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_SQUADS, range: 'All Data!A:H' })
            ]).catch(() => { throw new Error('Failed to retrieve data from Google Sheets.'); });

            const squadMembersData = (squadMembersResponse.data.values || []).slice(1);
            const squadLeadersData = (squadLeadersResponse.data.values || []).slice(1);
            const allData = (allDataResponse.data.values || []).slice(1);

            const userIsLeader = squadLeadersData.find(row => row && row.length > SL_ID && row[SL_ID]?.trim() === userId);
            if (userIsLeader) {
                const infoContainer = buildNoticeContainer({
                    title: 'Leaders Must Disband',
                    subtitle: 'Leave Squad',
                    lines: ['Squad leaders cannot leave their squad using this command.', 'Please use `/disband-squad`.']
                });
                return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [infoContainer], ephemeral: true });
            }

            const userInSquadRowIndex = squadMembersData.findIndex(row => row && row.length > 1 && row[1]?.trim() === userId);
            if (userInSquadRowIndex === -1) {
                const infoContainer = buildNoticeContainer({
                    title: 'No Squad Found',
                    subtitle: 'Leave Squad',
                    lines: ['You are not currently in a squad.']
                });
                return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [infoContainer], ephemeral: true });
            }

            const userInSquadRow = squadMembersData[userInSquadRowIndex];
            const squadName = userInSquadRow[2]?.trim();

            if (!squadName || squadName === 'N/A') {
                logger.warn(`User ${userTag} (${userId}) found in Squad Members sheet but without a valid squad name.`);
                const errorContainer = buildNoticeContainer({
                    title: 'Data Inconsistent',
                    subtitle: 'Leave Squad',
                    lines: ['Your squad data seems inconsistent.', 'Please contact an administrator.']
                });
                return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer], ephemeral: true });
            }

            logger.info(`User ${userTag} (${userId}) is leaving squad: ${squadName}`);

            let mascotRoleIdToRemove = null;
            const squadOwnerRowForEvent = squadLeadersData.find(row => row && row.length > SL_SQUAD_NAME && row[SL_SQUAD_NAME]?.trim() === squadName);
            if (squadOwnerRowForEvent) {
                const eventSquadName = squadOwnerRowForEvent[SL_EVENT_SQUAD];
                if (eventSquadName && eventSquadName !== 'N/A') {
                    const mascotInfo = findMascotByName(eventSquadName);
                    if (mascotInfo) {
                        mascotRoleIdToRemove = mascotInfo.roleId;
                        logger.info(`Identified mascot role ${mascotInfo.name} (${mascotRoleIdToRemove}) to remove from ${userTag}.`);
                    } else {
                        logger.warn(`Could not find role mapping for Event Squad '${eventSquadName}' of squad ${squadName}.`);
                    }
                }
            } else {
                logger.warn(`Could not find leader row for squad ${squadName} to check for Event Squad assignment.`);
            }


            const squadMemberSheetRowIndex = userInSquadRowIndex + 2;
            const clearRange = `Squad Members!A${squadMemberSheetRowIndex}:E${squadMemberSheetRowIndex}`;
            logger.info(`Clearing Squad Members range ${clearRange}`);
            await sheets.spreadsheets.values.clear({
                spreadsheetId: SPREADSHEET_SQUADS,
                range: clearRange }).catch(err => { throw new Error(`Failed to clear row in Squad Members sheet: ${err.message}`); });


            const userInAllDataIndex = allData.findIndex(row => row && row.length > AD_ID && row[AD_ID]?.trim() === userId);
            if (userInAllDataIndex !== -1) {
                const allDataSheetRowIndex = userInAllDataIndex + 2;
                const rangeToUpdate = `All Data!C${allDataSheetRowIndex}:G${allDataSheetRowIndex}`;
                const valuesToUpdate = [['N/A', 'N/A', 'N/A', 'FALSE', 'No']];
                logger.info(`Updating All Data range ${rangeToUpdate} for user ${userId}`);
                await sheets.spreadsheets.values.update({
                    spreadsheetId: SPREADSHEET_SQUADS,
                    range: rangeToUpdate,
                    valueInputOption: 'RAW',
                    resource: { values: valuesToUpdate } }).catch(err => { throw new Error(`Failed to update row in All Data sheet: ${err.message}`); });
            } else {
                logger.warn(`User ${userTag} (${userId}) was found in Squad Members but not in All Data sheet.`);
            }

            const squadOwnerRow = squadLeadersData.find(row => row && row.length > SL_SQUAD_NAME && row[SL_SQUAD_NAME]?.trim() === squadName);
            if (squadOwnerRow && squadOwnerRow[SL_ID]) {
                const ownerId = squadOwnerRow[SL_ID].trim();
                const ownerUsername = squadOwnerRow[0] || 'Leader';
                try {
                    const ownerUser = await interaction.client.users.fetch(ownerId);
                    const dmContainer = new ContainerBuilder();
                    const block = buildTextBlock({ title: 'Member Left Squad', subtitle: 'Squad Update', lines: [`Hello ${ownerUsername},`, `User **${userTag}** (<@${userId}>) has left your squad **${squadName}**.`] });
            if (block) dmContainer.addTextDisplayComponents(block);
                    await ownerUser.send({ flags: MessageFlags.IsComponentsV2, components: [dmContainer] }).catch(dmError => {
                        logger.error(`Failed to DM squad leader ${ownerId}: ${dmError.message}`);
                    });
                } catch (error) {
                    logger.error(`Failed to fetch squad leader user ${ownerId} for DM: ${error.message}`);
                }
            } else {
                logger.warn(`Could not find leader for squad ${squadName} to notify.`);
            }

            try {
                const loggingGuild = await interaction.client.guilds.fetch(BALLHEAD_GUILD_ID);
                const loggingChannel = await loggingGuild.channels.fetch(LOGGING_CHANNEL_ID);
                const logContainer = new ContainerBuilder();
                const block = buildTextBlock({ title: 'Member Left Squad', subtitle: 'Squad Activity', lines: [`User **${userTag}** (<@${userId}>) has left the squad **${squadName}**.`] });
            if (block) logContainer.addTextDisplayComponents(block);
                await loggingChannel.send({ flags: MessageFlags.IsComponentsV2, components: [logContainer] });
            } catch (logError) {
                logger.error(`Failed to send log message: ${logError.message}`);
            }


            try {
                if (member.nickname && member.nickname.toUpperCase().startsWith(`[${squadName.toUpperCase()}]`)) {
                    logger.info(`Resetting nickname for ${userTag}`);
                    await member.setNickname(null).catch(nickErr => {
                        if (nickErr.code !== 50013) { logger.error(`Could not change nickname for ${userTag} (${userId}): ${nickErr.message}`); }
                        else { logger.info(`Missing permissions to reset nickname for ${userTag} (${userId}).`);}
                    });
                } else {
                    logger.info(`Nickname for ${userTag} doesn't match squad format, not resetting.`);
                }

                if (mascotRoleIdToRemove) {
                    const roleToRemove = await guild.roles.fetch(mascotRoleIdToRemove).catch(() => null);
                    if (roleToRemove && member.roles.cache.has(roleToRemove.id)) {
                        logger.info(`Removing mascot role ${roleToRemove.name} from ${userTag}`);
                        await member.roles.remove(roleToRemove).catch(roleErr => {
                            if (roleErr.code !== 50013 && roleErr.code !== 10011) {
                                logger.error(`Could not remove mascot role ${roleToRemove.name} from ${userTag}: ${roleErr.message}`);
                            } else {
                                logger.info(`Missing permissions or role already gone for mascot role ${roleToRemove.name} on ${userTag}.`);
                            }
                        });
                    } else if (roleToRemove) {
                        logger.info(`User ${userTag} did not have mascot role ${roleToRemove.name} to remove.`);
                    } else {
                        logger.warn(`Mascot role ${mascotRoleIdToRemove} not found in guild for removal.`);
                    }
                }

                // Strip level roles when leaving a squad
                await stripLevelRoles(guild, userId);
            } catch (error) {
                if (error.code === 10007) { logger.info(`Member ${userTag} (${userId}) not found in guild ${GYM_CLASS_GUILD_ID}, cannot reset nickname/roles.`); }
                else { logger.error(`Error during nickname/role cleanup for ${userTag} (${userId}): ${error.message}`); }
            }

            const successContainer = buildNoticeContainer({
                title: 'Squad Left',
                subtitle: 'Leave Squad',
                lines: [
                    `You have successfully left the squad **${squadName}**.`,
                    'Any associated event roles have also been removed.'
                ]
            });
            await interaction.editReply({
                flags: MessageFlags.IsComponentsV2,
                components: [successContainer],
                ephemeral: true
            });

        } catch (error) {
            logger.error(`Error during /leave-squad for ${userTag} (${userId}):`, error);
            try {
                const errorGuild = await interaction.client.guilds.fetch(BALLHEAD_GUILD_ID);
                const errorChannel = await errorGuild.channels.fetch(BOT_BUGS_CHANNEL_ID);
                const errorContainer = new ContainerBuilder();
                const block = buildTextBlock({ title: 'Leave Squad Command Error', subtitle: 'Command Failure', lines: [`**User:** ${userTag} (${userId })`, `**Error:** ${error.message}`] });
            if (block) errorContainer.addTextDisplayComponents(block);
                await errorChannel.send({ flags: MessageFlags.IsComponentsV2, components: [errorContainer] });
            } catch (logError) {
                logger.error(`Failed to log error to error channel: ${logError.message}`);
            }
            if (!interaction.replied && !interaction.deferred) {
                const replyContainer = buildNoticeContainer({
                    title: 'Request Failed',
                    subtitle: 'Leave Squad',
                    lines: ['An error occurred while processing your request.']
                });
                await interaction.reply({ flags: MessageFlags.IsComponentsV2, components: [replyContainer], ephemeral: true }).catch(err => logger.error('Failed to reply:', err));
            } else if (!interaction.replied) {
                const replyContainer = buildNoticeContainer({
                    title: 'Request Failed',
                    subtitle: 'Leave Squad',
                    lines: ['An error occurred while processing your request.']
                });
                await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [replyContainer], ephemeral: true }).catch(err => logger.error('Failed to edit reply:', err));
            }
        }
    } };
