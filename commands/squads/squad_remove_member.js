const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const { getSheetsClient, getCachedValues, invalidateRanges } = require('../../utils/sheets_cache');
const { SPREADSHEET_SQUADS, GYM_CLASS_GUILD_ID, LOGGING_CHANNEL_ID, BOT_BUGS_CHANNEL_ID, SL_SQUAD_NAME, SL_EVENT_SQUAD } = require('../../config/constants');
const { findMascotByName } = require('../../config/squads');
const {
    buildSquadMemberChoices,
    findAllDataRowIndex,
    findMemberRowIndex,
    findUserSquads,
    isSameSquad,
    parseDiscordUserId,
    resolveOwnedSquadForMember,
    resolveSquadType,
    SM_USERNAME,
} = require('../../utils/squad_queries');
const logger = require('../../utils/logger');


module.exports = {
    data: new SlashCommandBuilder()
        .setName('squad-remove-member')
        .setDescription('Remove a member from your squad (Squad Leaders only).')
        .addStringOption(option =>
            option.setName('member')
                .setDescription('Select a stored squad member, or paste their Discord ID.')
                .setRequired(true)
                .setAutocomplete(true))
        .addStringOption(option =>
            option.setName('squad')
                .setDescription('Only needed if the member appears in multiple squads you own.')
                .setRequired(false)),

    async autocomplete(interaction) {
        try {
            const sheets = await getSheetsClient();
            const results = await getCachedValues({
                sheets,
                spreadsheetId: SPREADSHEET_SQUADS,
                ranges: ['Squad Leaders!A:G', 'Squad Members!A:E'],
                ttlMs: 15000,
            });
            const squadLeaders = (results.get('Squad Leaders!A:G') || []).slice(1);
            const squadMembers = (results.get('Squad Members!A:E') || []).slice(1);
            const specifiedSquad = interaction.options.getString('squad');
            const ownedSquads = findUserSquads(squadLeaders, interaction.user.id);
            const squadNames = ownedSquads
                .filter(row => !specifiedSquad || isSameSquad(row[SL_SQUAD_NAME], specifiedSquad))
                .map(row => row[SL_SQUAD_NAME]);
            const choices = buildSquadMemberChoices(
                squadMembers,
                squadNames,
                interaction.options.getFocused()
            );

            await interaction.respond(choices);
        } catch (error) {
            logger.error('[Remove From Squad] Autocomplete error:', error);
            await interaction.respond([]).catch(() => {});
        }
    },

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const commandUserID = interaction.user.id;
        const commandUserTag = interaction.user.tag;
        const targetUserID = parseDiscordUserId(interaction.options.getString('member'));
        let targetUserTag = targetUserID || 'unknown user';
        const guild = interaction.guild;

        if (!targetUserID) {
            const container = new ContainerBuilder();
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent('## Invalid Discord ID'),
                new TextDisplayBuilder().setContent('Select a member from the roster results, or paste a valid Discord user ID.')
            );
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true });
            return;
        }

        if (commandUserID === targetUserID) {
            const container = new ContainerBuilder();
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent('## Invalid Target'),
                new TextDisplayBuilder().setContent('You cannot remove yourself from your own squad.\nUse `/squad leave` or `/squad disband`.')
            );
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true });
            return;
        }

        const sheets = await getSheetsClient();

        try {
            const [allDataResponse, squadLeadersResponse, squadMembersResponse] = await Promise.all([
                sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_SQUADS, range: 'All Data!A:H' }),
                sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_SQUADS, range: 'Squad Leaders!A:G' }),
                sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_SQUADS, range: 'Squad Members!A:E' }),
            ]).catch(() => { throw new Error('Failed to retrieve data from Google Sheets.'); });

            const allData = (allDataResponse.data.values || []);
            const squadLeadersData = (squadLeadersResponse.data.values || []);
            const squadMembersData = (squadMembersResponse.data.values || []);

            allData.shift();
            squadLeadersData.shift();
            squadMembersData.shift();

            const specifiedSquad = interaction.options.getString('squad');
            const { squad: leaderRow, error: disambigError } = resolveOwnedSquadForMember(
                squadLeadersData,
                squadMembersData,
                commandUserID,
                targetUserID,
                specifiedSquad
            );
            if (disambigError) {
                const container = new ContainerBuilder();
                container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('## Access Denied'),
                    new TextDisplayBuilder().setContent(disambigError)
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

            const targetMemberRowIndex = findMemberRowIndex(squadMembersData, targetUserID, leaderSquadName);
            const targetMemberRow = targetMemberRowIndex === -1 ? null : squadMembersData[targetMemberRowIndex];

            if (!targetMemberRow || targetMemberRowIndex === -1) {
                const container = new ContainerBuilder();
                container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('## Member Not Found'),
                    new TextDisplayBuilder().setContent(`<@${targetUserID}> is not currently a member of your squad **${leaderSquadName}**.`)
                );
                await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true });
                return;
            }
            targetUserTag = String(targetMemberRow[SM_USERNAME] ?? '').trim() || targetUserID;

            const { squadType: squadTypeForRoles } = resolveSquadType(allData, commandUserID, leaderSquadName);
            const squadTypeRolesToRemove = [];

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

            const targetAllDataRowIndex = findAllDataRowIndex(allData, targetUserID, leaderSquadName);

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
            invalidateRanges(SPREADSHEET_SQUADS, ['Squad Members!A:E', 'All Data!A:H']);

            let discordCleanupStatus = 'not-in-server';
            try {
                const memberToRemove = await guild.members.fetch(targetUserID);
                discordCleanupStatus = 'completed';
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
                if (discordError.code === 10007 || discordError.code === 10013) {
                    logger.info(`Member ${targetUserTag} (${targetUserID}) is no longer in the server; stored squad membership was removed.`);
                } else {
                    discordCleanupStatus = 'failed';
                    logger.error(`Error updating Discord member ${targetUserTag}: ${discordError.message}`);
                    const warningContainer = new ContainerBuilder();
                    warningContainer.addTextDisplayComponents(
                        new TextDisplayBuilder().setContent('## Partial Cleanup'),
                        new TextDisplayBuilder().setContent(`The squad record was removed, but Discord roles or nickname cleanup failed for ${targetUserTag}.`)
                    );
                    await interaction.followUp({ flags: MessageFlags.IsComponentsV2, components: [warningContainer], ephemeral: true }).catch(followUpError => {
                        logger.error('Failed to send follow-up warning after remove-from-squad:', followUpError);
                    });
                }
            }

            try {
                const loggingGuild = await interaction.client.guilds.fetch(GYM_CLASS_GUILD_ID);
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
            const cleanupMessage = discordCleanupStatus === 'completed'
                ? 'Their squad roles and nickname were reset where applicable.'
                : discordCleanupStatus === 'not-in-server'
                    ? 'They are no longer in the server, so only their stored squad record needed to be removed.'
                    : 'Their stored squad record was removed, but Discord role or nickname cleanup could not be completed.';
            successContainer.addTextDisplayComponents(
                new TextDisplayBuilder().setContent('## Member Removed'),
                new TextDisplayBuilder().setContent([
                    `<@${targetUserID}> has been successfully removed from **${leaderSquadName}**.`,
                    cleanupMessage
                ].join('\n'))
            );
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [successContainer], ephemeral: true });

        } catch (error) {
            logger.error(`Error during /squad remove-member for ${commandUserTag} removing ${targetUserTag}:`, error);
            try {
                const errorGuild = await interaction.client.guilds.fetch(GYM_CLASS_GUILD_ID);
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
