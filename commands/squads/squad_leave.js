const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const { getSheetsClient } = require('../../utils/sheets_cache');

function buildTextBlock({ title, subtitle, lines } = {}) {
    const parts = [];
    if (title) {
        parts.push(`## ${title}`);
    }
    if (subtitle) {
        parts.push(subtitle);
    }
    if (Array.isArray(lines) && lines.length > 0) {
        if (parts.length > 0) {
            parts.push('');
        }
        parts.push(...lines.filter(Boolean));
    }
    if (parts.length === 0) {
        return null;
    }
    return new TextDisplayBuilder().setContent(parts.join('\n'));
}

const GUILD_ID = '752216589792706621';
const LOGGING_GUILD_ID = '1233740086839869501';
const LOGGING_CHANNEL_ID = '1233853415952748645';
const ERROR_LOGGING_CHANNEL_ID = '1233853458092658749';
const SPREADSHEET_ID = '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k';
const mascotSquads = [
    { name: 'Duck Squad', roleId: '1359614680615620608' },
    { name: 'Pumpkin Squad', roleId: '1361466564292907060' },
    { name: 'Snowman Squad', roleId: '1361466801443180584' },
    { name: 'Gorilla Squad', roleId: '1361466637261471961' },
    { name: 'Bee Squad', roleId: '1361466746149666956' },
    { name: 'Alligator Squad', roleId: '1361466697059664043' },
];
const SL_ID = 1;
const SL_SQUAD_NAME = 2;
const SL_EVENT_SQUAD = 3;
const AD_ID = 1;

function buildNoticeContainer({ title, subtitle, lines}) {
    const container = new ContainerBuilder();
    const block = buildTextBlock({ title, subtitle, lines });
            if (block) container.addTextDisplayComponents(block);
    return container;
}

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
                sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Squad Members!A:E' }),
                sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Squad Leaders!A:F' }),
                sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'All Data!A:H' })
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
                console.warn(`User ${userTag} (${userId}) found in Squad Members sheet but without a valid squad name.`);
                const errorContainer = buildNoticeContainer({
                    title: 'Data Inconsistent',
                    subtitle: 'Leave Squad',
                    lines: ['Your squad data seems inconsistent.', 'Please contact an administrator.']
                });
                return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer], ephemeral: true });
            }

            console.log(`User ${userTag} (${userId}) is leaving squad: ${squadName}`);

            let mascotRoleIdToRemove = null;
            const squadOwnerRowForEvent = squadLeadersData.find(row => row && row.length > SL_SQUAD_NAME && row[SL_SQUAD_NAME]?.trim() === squadName);
            if (squadOwnerRowForEvent) {
                const eventSquadName = squadOwnerRowForEvent[SL_EVENT_SQUAD];
                if (eventSquadName && eventSquadName !== 'N/A') {
                    const mascotInfo = mascotSquads.find(m => m.name === eventSquadName);
                    if (mascotInfo) {
                        mascotRoleIdToRemove = mascotInfo.roleId;
                        console.log(`Identified mascot role ${mascotInfo.name} (${mascotRoleIdToRemove}) to remove from ${userTag}.`);
                    } else {
                        console.warn(`Could not find role mapping for Event Squad '${eventSquadName}' of squad ${squadName}.`);
                    }
                }
            } else {
                console.warn(`Could not find leader row for squad ${squadName} to check for Event Squad assignment.`);
            }


            const squadMemberSheetRowIndex = userInSquadRowIndex + 2;
            const clearRange = `Squad Members!A${squadMemberSheetRowIndex}:E${squadMemberSheetRowIndex}`;
            console.log(`Clearing Squad Members range ${clearRange}`);
            await sheets.spreadsheets.values.clear({
                spreadsheetId: SPREADSHEET_ID,
                range: clearRange }).catch(err => { throw new Error(`Failed to clear row in Squad Members sheet: ${err.message}`); });


            const userInAllDataIndex = allData.findIndex(row => row && row.length > AD_ID && row[AD_ID]?.trim() === userId);
            if (userInAllDataIndex !== -1) {
                const allDataSheetRowIndex = userInAllDataIndex + 2;
                const rangeToUpdate = `All Data!C${allDataSheetRowIndex}:G${allDataSheetRowIndex}`;
                const valuesToUpdate = [['N/A', 'N/A', 'N/A', 'FALSE', 'No']];
                console.log(`Updating All Data range ${rangeToUpdate} for user ${userId}`);
                await sheets.spreadsheets.values.update({
                    spreadsheetId: SPREADSHEET_ID,
                    range: rangeToUpdate,
                    valueInputOption: 'RAW',
                    resource: { values: valuesToUpdate } }).catch(err => { throw new Error(`Failed to update row in All Data sheet: ${err.message}`); });
            } else {
                console.warn(`User ${userTag} (${userId}) was found in Squad Members but not in All Data sheet.`);
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
                        console.error(`Failed to DM squad leader ${ownerId}: ${dmError.message}`);
                    });
                } catch (error) {
                    console.error(`Failed to fetch squad leader user ${ownerId} for DM: ${error.message}`);
                }
            } else {
                console.warn(`Could not find leader for squad ${squadName} to notify.`);
            }

            try {
                const loggingGuild = await interaction.client.guilds.fetch(LOGGING_GUILD_ID);
                const loggingChannel = await loggingGuild.channels.fetch(LOGGING_CHANNEL_ID);
                const logContainer = new ContainerBuilder();
                const block = buildTextBlock({ title: 'Member Left Squad', subtitle: 'Squad Activity', lines: [`User **${userTag}** (<@${userId}>) has left the squad **${squadName}**.`] });
            if (block) logContainer.addTextDisplayComponents(block);
                await loggingChannel.send({ flags: MessageFlags.IsComponentsV2, components: [logContainer] });
            } catch (logError) {
                console.error(`Failed to send log message: ${logError.message}`);
            }


            try {
                if (member.nickname && member.nickname.toUpperCase().startsWith(`[${squadName.toUpperCase()}]`)) {
                    console.log(`Resetting nickname for ${userTag}`);
                    await member.setNickname(null).catch(nickErr => {
                        if (nickErr.code !== 50013) { console.error(`Could not change nickname for ${userTag} (${userId}):`, nickErr.message); }
                        else { console.log(`Missing permissions to reset nickname for ${userTag} (${userId}).`);}
                    });
                } else {
                    console.log(`Nickname for ${userTag} doesn't match squad format, not resetting.`);
                }

                if (mascotRoleIdToRemove) {
                    const roleToRemove = await guild.roles.fetch(mascotRoleIdToRemove).catch(() => null);
                    if (roleToRemove && member.roles.cache.has(roleToRemove.id)) {
                        console.log(`Removing mascot role ${roleToRemove.name} from ${userTag}`);
                        await member.roles.remove(roleToRemove).catch(roleErr => {
                            if (roleErr.code !== 50013 && roleErr.code !== 10011) {
                                console.error(`Could not remove mascot role ${roleToRemove.name} from ${userTag}:`, roleErr.message);
                            } else {
                                console.log(`Missing permissions or role already gone for mascot role ${roleToRemove.name} on ${userTag}.`);
                            }
                        });
                    } else if (roleToRemove) {
                        console.log(`User ${userTag} did not have mascot role ${roleToRemove.name} to remove.`);
                    } else {
                        console.warn(`Mascot role ${mascotRoleIdToRemove} not found in guild for removal.`);
                    }
                }
            } catch (error) {
                if (error.code === 10007) { console.log(`Member ${userTag} (${userId}) not found in guild ${GUILD_ID}, cannot reset nickname/roles.`); }
                else { console.error(`Error during nickname/role cleanup for ${userTag} (${userId}):`, error.message); }
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
            console.error(`Error during /leave-squad for ${userTag} (${userId}):`, error);
            try {
                const errorGuild = await interaction.client.guilds.fetch(LOGGING_GUILD_ID);
                const errorChannel = await errorGuild.channels.fetch(ERROR_LOGGING_CHANNEL_ID);
                const errorContainer = new ContainerBuilder();
                const block = buildTextBlock({ title: 'Leave Squad Command Error', subtitle: 'Command Failure', lines: [`**User:** ${userTag} (${userId })`, `**Error:** ${error.message}`] });
            if (block) errorContainer.addTextDisplayComponents(block);
                await errorChannel.send({ flags: MessageFlags.IsComponentsV2, components: [errorContainer] });
            } catch (logError) {
                console.error(`Failed to log error to error channel: ${logError.message}`);
            }
            if (!interaction.replied && !interaction.deferred) {
                const replyContainer = buildNoticeContainer({
                    title: 'Request Failed',
                    subtitle: 'Leave Squad',
                    lines: ['An error occurred while processing your request.']
                });
                await interaction.reply({ flags: MessageFlags.IsComponentsV2, components: [replyContainer], ephemeral: true }).catch(console.error);
            } else if (!interaction.replied) {
                const replyContainer = buildNoticeContainer({
                    title: 'Request Failed',
                    subtitle: 'Leave Squad',
                    lines: ['An error occurred while processing your request.']
                });
                await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [replyContainer], ephemeral: true }).catch(console.error);
            }
        }
    } };
