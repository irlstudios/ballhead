const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const credentials = require('../../resources/secret.json');

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

async function authorize() {
    const { client_email, private_key } = credentials;
    const auth = new google.auth.JWT({
        email: client_email,
        key: private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    await auth.authorize();
    return auth;
}

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
            await interaction.editReply({ content: 'Could not retrieve your member information.', ephemeral: true });
            return;
        }
        const guild = interaction.guild;
        if (!guild) {
            await interaction.editReply({ content: 'This command must be run in a server.', ephemeral: true });
            return;
        }

        const auth = await authorize();
        const sheets = google.sheets({ version: 'v4', auth });

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
                await interaction.editReply({ content: 'You are already a squad leader and cannot join another squad.', ephemeral: true }); return;
            }
            let userAllDataRowIndex = -1;
            const userAllDataRow = allData.find((row, index) => { if (row && row.length > AD_ID && row[AD_ID] === userId) { userAllDataRowIndex = index; return true; } return false; });
            if (userAllDataRow) {
                if (userAllDataRow[AD_SQUAD_NAME] && userAllDataRow[AD_SQUAD_NAME] !== 'N/A') {
                    await interaction.editReply({ content: `You are already in squad **${userAllDataRow[AD_SQUAD_NAME]}**. You must leave it first.`, ephemeral: true }); return;
                }
                if (userAllDataRow[AD_PREFERENCE] === 'FALSE') {
                    await interaction.editReply({ content: 'You have opted out of squad invitations/joining. Use `/squad-opt-in` first.', ephemeral: true }); return;
                }
            }

            const openSquadLeaders = squadLeadersData.filter(row => row && row.length > SL_OPEN_SQUAD && row[SL_OPEN_SQUAD] === 'TRUE' && row[SL_SQUAD_NAME] && row[SL_SQUAD_NAME] !== 'N/A');
            if (openSquadLeaders.length === 0) {
                await interaction.editReply({ content: 'Sorry, there are currently no squads open for joining.', ephemeral: true }); return;
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
                await interaction.editReply({ content: 'Sorry, all open squads are currently full.', ephemeral: true }); return;
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
                if (nickError.code === 50013) { console.warn(`Missing permissions to set nickname for ${userTag}`); await interaction.followUp({ content: `Warning: Could not set your nickname due to permissions. Set it manually to \`[${chosenSquad.name}] ${username}\`.`, ephemeral: true }); }
                else { console.warn(`Failed to set nickname for ${userTag}: ${nickError.message}`); await interaction.followUp({ content: `Warning: Failed to set nickname. Set it manually to \`[${chosenSquad.name}] ${username}\`.`, ephemeral: true }); }
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
                            await interaction.followUp({ content: `Warning: Could not find the Discord role for the squad's mascot team (${mascotInfo.name}). Please contact an admin.`, ephemeral: true });
                        }
                    } catch (roleError) {
                        console.error(`Failed to add mascot role ${mascotInfo.name} to ${userTag}: ${roleError.message}`);
                        await interaction.followUp({ content: `Warning: Could not assign the mascot role (${mascotInfo.name}) due to an error.`, ephemeral: true });
                    }
                } else {
                    console.warn(`Could not find role ID mapping for event squad: ${chosenSquad.eventSquad}`);
                }
            }


            let successDescription = `You have successfully joined the squad: **${chosenSquad.name}** (${chosenSquad.type})!`;
            if (assignedMascotRole) {
                successDescription += `\nYou have also been assigned the **${assignedMascotRole}** role as part of the ongoing event.`;
            }
            const successEmbed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('Joined Squad!')
                .setDescription(successDescription)
                .setTimestamp();
            await interaction.editReply({ embeds: [successEmbed], ephemeral: true });


            try {
                const leaderUser = await interaction.client.users.fetch(chosenSquad.leaderId);
                let leaderDmDescription = `<@${userId}> (${userTag}) has joined your squad **${chosenSquad.name}** via the random join command!`;
                if (assignedMascotRole) {
                    leaderDmDescription += ` They have been assigned the **${assignedMascotRole}** role.`;
                }
                const leaderDmEmbed = new EmbedBuilder()
                    .setColor('#FFFF00')
                    .setTitle('New Member Joined!')
                    .setDescription(leaderDmDescription)
                    .setTimestamp();
                await leaderUser.send({ embeds: [leaderDmEmbed] });
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
                const logEmbed = new EmbedBuilder()
                    .setTitle('User Joined Random Squad')
                    .setDescription(logDescription)
                    .setColor('#00FFFF')
                    .setTimestamp();
                await loggingChannel.send({ embeds: [logEmbed] });
            } catch (logError) { 
                console.error('Failed to log random join action:', logError);
            }


        } catch (error) {
            console.error(`Error processing /join-random-squad for ${userTag}:`, error);

            try {
                const errorGuild = await interaction.client.guilds.fetch(LOGGING_GUILD_ID);
                const errorChannel = await errorGuild.channels.fetch(ERROR_LOGGING_CHANNEL_ID);
                const errorEmbed = new EmbedBuilder() /* ... error log embed ... */
                    .setTitle('Join Random Squad Command Error')
                    .setDescription(`**User:** ${userTag} (${userId})\n**Error:** ${error.message}`)
                    .setColor('#FF0000')
                    .setTimestamp();
                await errorChannel.send({ embeds: [errorEmbed] });
            } catch (logError) { 
                console.error('Failed to log join command error:', logError);
            }
            
            await interaction.editReply({
                content: `An error occurred: ${error.message || 'Could not process your request. Please try again later.'}`,
                ephemeral: true
            }).catch(console.error);
        }
    }
};