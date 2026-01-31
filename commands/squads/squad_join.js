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

const SPREADSHEET_ID = '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k';
const MAX_SQUAD_MEMBERS = 10;
const LOGGING_GUILD_ID = '1233740086839869501';
const LOGGING_CHANNEL_ID = '1233853415952748645';
const ERROR_LOGGING_CHANNEL_ID = '1233853458092658749';

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
const SL_OPEN_SQUAD = 4;
const SM_SQUAD_NAME = 2;
const AD_ID = 1;
const AD_SQUAD_NAME = 2;
const AD_SQUAD_TYPE = 3;
const AD_EVENT_SQUAD = 4;
const AD_PREFERENCE = 7;

function buildNoticeContainer({ title, subtitle, lines}) {
    const container = new ContainerBuilder();
    const block = buildTextBlock({ title, subtitle, lines });
            if (block) container.addTextDisplayComponents(block);
    return container;
}


module.exports = {
    data: new SlashCommandBuilder()
        .setName('join-random-squad')
        .setDescription('Attempt to join a random squad that is currently open.'),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const userId = interaction.user.id;
        const userTag = interaction.user.tag;
        const username = interaction.user.username;
        const member = interaction.member;

        if (!member) {
            const errorContainer = buildNoticeContainer({
                title: 'Member Missing',
                subtitle: 'Random Squad Join',
                lines: ['Could not retrieve your member information.']
            });
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer], ephemeral: true });
            return;
        }
        const guild = interaction.guild;
        if (!guild) {
            const errorContainer = buildNoticeContainer({
                title: 'Server Required',
                subtitle: 'Random Squad Join',
                lines: ['This command must be run in a server.']
            });
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer], ephemeral: true });
            return;
        }

        const sheets = await getSheetsClient();

        try {
            const [allDataResponse, squadLeadersResponse, squadMembersResponse] = await Promise.all([
                sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'All Data!A:H' }),
                sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Squad Leaders!A:F' }),
                sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Squad Members!A:E' }),
            ]).catch(err => {
                console.error('Error fetching sheet data for random join:', err); throw new Error('Failed to retrieve necessary data from Google Sheets.');
            });

            const allData = (allDataResponse.data.values || []);
            const squadLeadersData = (squadLeadersResponse.data.values || []);
            const squadMembersData = (squadMembersResponse.data.values || []);

            const userIsLeader = squadLeadersData.find(row => row && row.length > SL_ID && row[SL_ID] === userId);
            if (userIsLeader) {
                const infoContainer = buildNoticeContainer({
                    title: 'Already a Leader',
                    subtitle: 'Random Squad Join',
                    lines: ['You are already a squad leader and cannot join another squad.']
                });
                await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [infoContainer], ephemeral: true });
                return;
            }
            let userAllDataRowIndex = -1;
            const userAllDataRow = allData.find((row, index) => { if (row && row.length > AD_ID && row[AD_ID] === userId) { userAllDataRowIndex = index; return true; } return false; });
            if (userAllDataRow) {
                if (userAllDataRow[AD_SQUAD_NAME] && userAllDataRow[AD_SQUAD_NAME] !== 'N/A') {
                    const infoContainer = buildNoticeContainer({
                        title: 'Already in a Squad',
                        subtitle: 'Random Squad Join',
                        lines: [`You are already in squad **${userAllDataRow[AD_SQUAD_NAME]}**.`, 'You must leave it first.']
                    });
                    await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [infoContainer], ephemeral: true });
                    return;
                }
                if (userAllDataRow[AD_PREFERENCE] === 'FALSE') {
                    const infoContainer = buildNoticeContainer({
                        title: 'Opted Out',
                        subtitle: 'Random Squad Join',
                        lines: ['You have opted out of squad invitations/joining.', 'Use `/squad-opt-in` first.']
                    });
                    await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [infoContainer], ephemeral: true });
                    return;
                }
            }

            const openSquadLeaders = squadLeadersData.filter(row => row && row.length > SL_OPEN_SQUAD && row[SL_OPEN_SQUAD] === 'TRUE' && row[SL_SQUAD_NAME] && row[SL_SQUAD_NAME] !== 'N/A');
            if (openSquadLeaders.length === 0) {
                const infoContainer = buildNoticeContainer({
                    title: 'No Open Squads',
                    subtitle: 'Random Squad Join',
                    lines: ['Sorry, there are currently no squads open for joining.']
                });
                await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [infoContainer], ephemeral: true });
                return;
            }
            const availableSquads = [];
            for (const leaderRow of openSquadLeaders) {
                const squadName = leaderRow[SL_SQUAD_NAME];
                const currentMembers = squadMembersData.filter(memberRow => memberRow && memberRow.length > SM_SQUAD_NAME && memberRow[SM_SQUAD_NAME] === squadName);
                const totalOccupants = currentMembers.length + 1;
                if (totalOccupants < MAX_SQUAD_MEMBERS) {
                    const leaderAllData = allData.find(adRow => adRow && adRow.length > AD_ID && adRow[AD_ID] === leaderRow[SL_ID]);
                    const squadType = leaderAllData ? leaderAllData[AD_SQUAD_TYPE] : 'Unknown';
                    const eventSquadName = leaderRow[SL_EVENT_SQUAD] || (leaderAllData ? leaderAllData[AD_EVENT_SQUAD] : null);

                    availableSquads.push({
                        name: squadName,
                        leaderId: leaderRow[SL_ID],
                        type: squadType,
                        eventSquad: (eventSquadName && eventSquadName !== 'N/A') ? eventSquadName : null
                    });
                }
            }
            if (availableSquads.length === 0) {
                const infoContainer = buildNoticeContainer({
                    title: 'All Squads Full',
                    subtitle: 'Random Squad Join',
                    lines: ['Sorry, all open squads are currently full.']
                });
                await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [infoContainer], ephemeral: true });
                return;
            }

            const randomIndex = Math.floor(Math.random() * availableSquads.length);
            const chosenSquad = availableSquads[randomIndex];
            console.log(`User ${userTag} randomly assigned to join squad ${chosenSquad.name}`);

            let currentDate = new Date();
            let dateString = `${(currentDate.getMonth() + 1).toString().padStart(2, '0')}/${currentDate.getDate().toString().padStart(2, '0')}/${currentDate.getFullYear().toString().slice(-2)}`;
            const newSquadMemberRow = [username, userId, chosenSquad.name, 'N/A', dateString];
            await sheets.spreadsheets.values.append({ spreadsheetId: SPREADSHEET_ID, range: 'Squad Members!A1', valueInputOption: 'RAW', resource: { values: [newSquadMemberRow] } })
                .catch(err => { throw new Error(`Failed to add you to the Squad Members sheet: ${err.message}`); });

            let existingPreference = 'TRUE';
            if (userAllDataRow && userAllDataRow.length > AD_PREFERENCE) { existingPreference = userAllDataRow[AD_PREFERENCE] || 'TRUE'; }
            if (userAllDataRowIndex !== -1) {
                const sheetRowIndex = userAllDataRowIndex + 2;
                const valuesToUpdate = [chosenSquad.name, chosenSquad.type, 'N/A', 'FALSE', 'No'];
                await sheets.spreadsheets.values.update({ spreadsheetId: SPREADSHEET_ID, range: `All Data!C${sheetRowIndex}:G${sheetRowIndex}`, valueInputOption: 'RAW', resource: { values: [valuesToUpdate] } })
                    .catch(err => { throw new Error(`Failed to update your record in All Data sheet: ${err.message}`); });
            } else {
                const newAllDataRow = [username, userId, chosenSquad.name, chosenSquad.type, 'N/A', 'FALSE', 'No', existingPreference];
                await sheets.spreadsheets.values.append({ spreadsheetId: SPREADSHEET_ID, range: 'All Data!A1', valueInputOption: 'RAW', resource: { values: [newAllDataRow] } })
                    .catch(err => { throw new Error(`Failed to add your record to All Data sheet: ${err.message}`); });
            }
            console.log(`Updated sheets for ${userTag} joining ${chosenSquad.name}`);

            try {
                await member.setNickname(`[${chosenSquad.name}] ${username}`);
            } catch (nickError) { /* ... handle nickname error ... */
                if (nickError.code === 50013) {
                    console.warn(`Missing permissions to set nickname for ${userTag}`);
                    const warningContainer = buildNoticeContainer({
                        title: 'Nickname Not Updated',
                        subtitle: 'Permission Required',
                        lines: [`Set it manually to \`[${chosenSquad.name}] ${username}\`.`]
                    });
                    await interaction.followUp({ flags: MessageFlags.IsComponentsV2, components: [warningContainer], ephemeral: true });
                } else {
                    console.warn(`Failed to set nickname for ${userTag}: ${nickError.message}`);
                    const warningContainer = buildNoticeContainer({
                        title: 'Nickname Update Failed',
                        subtitle: 'Manual Update Needed',
                        lines: [`Set it manually to \`[${chosenSquad.name}] ${username}\`.`]
                    });
                    await interaction.followUp({ flags: MessageFlags.IsComponentsV2, components: [warningContainer], ephemeral: true });
                }
            }

            let assignedMascotRole = null;
            if (chosenSquad.eventSquad) {
                const mascotInfo = mascotSquads.find(m => m.name === chosenSquad.eventSquad);
                if (mascotInfo) {
                    try {
                        const roleToAdd = await guild.roles.fetch(mascotInfo.roleId);
                        if (roleToAdd) {
                            await member.roles.add(roleToAdd);
                            assignedMascotRole = roleToAdd.name;
                            console.log(`Added mascot role '${assignedMascotRole}' to ${userTag}`);
                        } else {
                            console.warn(`Mascot role ID ${mascotInfo.roleId} (${mascotInfo.name}) not found in guild.`);
                            const warningContainer = buildNoticeContainer({
                                title: 'Mascot Role Missing',
                                subtitle: 'Role Lookup Failed',
                                lines: [`Could not find the Discord role for the squad's mascot team (${mascotInfo.name}).`, 'Please contact an admin.']
                            });
                            await interaction.followUp({ flags: MessageFlags.IsComponentsV2, components: [warningContainer], ephemeral: true });
                        }
                    } catch (roleError) {
                        console.error(`Failed to add mascot role ${mascotInfo.name} to ${userTag}: ${roleError.message}`);
                        const warningContainer = buildNoticeContainer({
                            title: 'Mascot Role Not Assigned',
                            subtitle: 'Role Update Failed',
                            lines: [`Could not assign the mascot role (${mascotInfo.name}) due to an error.`]
                        });
                        await interaction.followUp({ flags: MessageFlags.IsComponentsV2, components: [warningContainer], ephemeral: true });
                    }
                } else {
                    console.warn(`Could not find role ID mapping for event squad: ${chosenSquad.eventSquad}`);
                }
            }


            let successDescription = `You have successfully joined the squad: **${chosenSquad.name}** (${chosenSquad.type})!`;
            if (assignedMascotRole) {
                successDescription += `\nYou have also been assigned the **${assignedMascotRole}** role as part of the ongoing event.`;
            }
            const successContainer = new ContainerBuilder();
            const block = buildTextBlock({ title: 'Joined Squad!', subtitle: 'Random Squad Join', lines: [successDescription] });
            if (block) successContainer.addTextDisplayComponents(block);
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [successContainer], ephemeral: true });


            try {
                const leaderUser = await interaction.client.users.fetch(chosenSquad.leaderId);
                let leaderDmDescription = `<@${userId}> (${userTag}) has joined your squad **${chosenSquad.name}** via the random join command!`;
                if (assignedMascotRole) {
                    leaderDmDescription += ` They have been assigned the **${assignedMascotRole}** role.`;
                }
                const leaderDmContainer = new ContainerBuilder();
                const block = buildTextBlock({ title: 'New Member Joined!', subtitle: 'Random Squad Join', lines: [leaderDmDescription] });
            if (block) leaderDmContainer.addTextDisplayComponents(block);
                await leaderUser.send({ flags: MessageFlags.IsComponentsV2, components: [leaderDmContainer] });
            } catch (dmError) {
                console.error(`Failed to send DM notification to leader ${chosenSquad.leaderId}: ${dmError.message}`);
            }

            try {
                const loggingGuild = await interaction.client.guilds.fetch(LOGGING_GUILD_ID);
                const loggingChannel = await loggingGuild.channels.fetch(LOGGING_CHANNEL_ID);
                let logDescription = `**User:** ${userTag} (<@${userId}>)\n**Joined Squad:** ${chosenSquad.name}\n**Leader:** <@${chosenSquad.leaderId}>`;
                if (assignedMascotRole) {
                    logDescription += `\n**Assigned Mascot Role:** ${assignedMascotRole}`;
                }
                const logContainer = new ContainerBuilder();
                const block = buildTextBlock({ title: 'User Joined Random Squad', subtitle: 'Squad Activity', lines: [logDescription] });
            if (block) logContainer.addTextDisplayComponents(block);
                await loggingChannel.send({ flags: MessageFlags.IsComponentsV2, components: [logContainer] });
            } catch (logError) {
                console.error('Failed to log random join action:', logError);
            }


        } catch (error) {
            console.error(`Error processing /join-random-squad for ${userTag}:`, error);

            try {
                const errorGuild = await interaction.client.guilds.fetch(LOGGING_GUILD_ID);
                const errorChannel = await errorGuild.channels.fetch(ERROR_LOGGING_CHANNEL_ID);
                const errorContainer = new ContainerBuilder();
                const block = buildTextBlock({ title: 'Join Random Squad Error', subtitle: 'Command Failure', lines: [`**User:** ${userTag} (${userId })`, `**Error:** ${error.message}`] });
            if (block) errorContainer.addTextDisplayComponents(block);
                await errorChannel.send({ flags: MessageFlags.IsComponentsV2, components: [errorContainer] });
            } catch (logError) {
                console.error('Failed to log join command error:', logError);
            }
            
            const replyContainer = buildNoticeContainer({
                title: 'Request Failed',
                subtitle: 'Random Squad Join',
                lines: [`An error occurred: ${error.message || 'Could not process your request. Please try again later.'}`]
            });
            await interaction.editReply({
                flags: MessageFlags.IsComponentsV2,
                components: [replyContainer],
                ephemeral: true
            }).catch(console.error);
        }
    }
};
