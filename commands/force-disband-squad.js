const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const axios = require('axios');
const credentials = require('../resources/secret.json');

const MODERATOR_ROLES = ['805833778064130104', '909227142808756264'];
const SQUAD_OWNER_ROLES = ['1218468103382499400', '1288918946258489354', '1290803054140199003'];

const compSquadLevelRoles = [
    '1288918067178508423',
    '1288918165417365576',
    '1288918209294237707',
    '1288918281343733842',
    '1200889836844896316'
];

const contentSquadLevelRoles = [
    '1291090496869109762',
    '1291090569346682931',
    '1291090608315699229',
    '1291090760405356708'
];

function authorize() {
    const { client_email, private_key } = credentials;
    const auth = new google.auth.JWT(
        client_email,
        null,
        private_key,
        ['https://www.googleapis.com/auth/spreadsheets']
    );
    return auth;
}

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

        const squadName = interaction.options.getString('squad-name');
        const userId = interaction.user.id;
        const member = await interaction.guild.members.fetch(userId);
        const isMod = MODERATOR_ROLES.some(roleId => member.roles.cache.has(roleId));

        if (!isMod) {
            return interaction.editReply({
                content: 'You do not have permission to use this command.',
                ephemeral: true
            });
        }

        const auth = authorize();
        const sheets = google.sheets({ version: 'v4', auth });

        try {
            const squadLeadersResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k',
                range: 'Squad Leaders!A:D'
            });

            const squadMembersResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k',
                range: 'Squad Members!A:D'
            });

            const allDataResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k',
                range: 'All Data!A:F'
            });

            const squadLeaders = squadLeadersResponse.data.values || [];
            const squadMembers = squadMembersResponse.data.values || [];
            const allData = allDataResponse.data.values || [];

            const squadLeaderRow = squadLeaders.find(row => row[2] === squadName);
            if (!squadLeaderRow) {
                return interaction.editReply({
                    content: `Squad **${squadName}** does not exist.`,
                    ephemeral: true
                });
            }

            const squadLeaderId = squadLeaderRow[1];
            const squadTypeRow = allData.find(row => row[2] === squadName);
            const squadType = squadTypeRow ? squadTypeRow[3] : 'Unknown';

            const squadMadeRow = allData.find(row => row[2] === squadName);
            const squadTypeForRoles = squadTypeRow ? squadTypeRow[3] : null;

            const squadTypeRoles = squadTypeForRoles === 'Competitive' ? compSquadLevelRoles :
                squadTypeForRoles === 'Content' ? contentSquadLevelRoles : [];

            const squadMembersToNotify = squadMembers.filter(row => row[2] === squadName);
            for (const memberRow of squadMembersToNotify) {
                const memberId = memberRow[1];
                const guildMember = await interaction.guild.members.fetch(memberId).catch(() => null);
                if (guildMember) {
                    const dmEmbed = new EmbedBuilder()
                        .setTitle('Squad Disbanded')
                        .setDescription(`The squad **${squadName}** has been forcefully disbanded by a moderator.`)
                        .setColor(0xFF0000);
                    await guildMember.send({ embeds: [dmEmbed] }).catch(() => null);

                    try {
                        await guildMember.setNickname(guildMember.user.username);

                        if (squadTypeRoles.length > 0) {
                            await guildMember.roles.remove(squadTypeRoles).catch(err => console.log(`Failed to remove roles from ${memberId}:`, err.message));
                        }
                    } catch (error) {
                        console.log(`Could not reset nickname or remove roles for ${memberId}:`, error.message);
                    }
                }
            }

            const leader = await interaction.guild.members.fetch(squadLeaderId).catch(() => null);
            if (leader) {
                const leaderEmbed = new EmbedBuilder()
                    .setTitle('Your Squad Was Disbanded')
                    .setDescription(`Your squad **${squadName}** has been forcefully disbanded by a moderator.`)
                    .setColor(0xFF0000);

                await leader.send({ embeds: [leaderEmbed] }).catch(() => null);

                try {
                    const rolesToRemove = SQUAD_OWNER_ROLES.filter(roleId => leader.roles.cache.has(roleId));
                    if (rolesToRemove.length > 0) {
                        await leader.roles.remove(rolesToRemove);
                    }
                    await leader.setNickname(leader.user.username);

                    if (squadTypeRoles.length > 0) {
                        await leader.roles.remove(squadTypeRoles).catch(err => console.log(`Failed to remove roles from leader ${squadLeaderId}:`, err.message));
                    }

                } catch (error) {
                    console.log(`Could not remove roles or reset nickname for ${squadLeaderId}:`, error.message);
                }
            }

            const updatedSquadMembers = squadMembers.filter(row => row[2] !== squadName);
            const updatedAllData = allData.map(row => {
                if (row[2] === squadName) {
                    row[2] = 'N/A';
                    row[3] = 'N/A';
                    row[4] = 'No';
                }
                return row;
            });

            const updatedSquadLeaders = squadLeaders.filter(row => row[1] !== squadLeaderId);
            const leaderDataRowIndex = allData.findIndex(row => row[1] === squadLeaderId);
            if (leaderDataRowIndex !== -1) {
                updatedAllData[leaderDataRowIndex][2] = 'N/A';
                updatedAllData[leaderDataRowIndex][3] = 'N/A';
                updatedAllData[leaderDataRowIndex][4] = 'No';
            }

            await sheets.spreadsheets.values.clear({
                spreadsheetId: '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k',
                range: 'Squad Members!A:D'
            });

            if (updatedSquadMembers.length > 0) {
                await sheets.spreadsheets.values.update({
                    spreadsheetId: '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k',
                    range: 'Squad Members!A:D',
                    valueInputOption: 'RAW',
                    resource: { values: updatedSquadMembers }
                });
            }

            await sheets.spreadsheets.values.clear({
                spreadsheetId: '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k',
                range: 'Squad Leaders!A:D'
            });

            if (updatedSquadLeaders.length > 0) {
                await sheets.spreadsheets.values.update({
                    spreadsheetId: '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k',
                    range: 'Squad Leaders!A:D',
                    valueInputOption: 'RAW',
                    resource: { values: updatedSquadLeaders }
                });
            }

            await sheets.spreadsheets.values.update({
                spreadsheetId: '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k',
                range: 'All Data!A:F',
                valueInputOption: 'RAW',
                resource: { values: updatedAllData }
            });

            const loggingGuild = await interaction.client.guilds.fetch('1233740086839869501');
            const loggingChannel = await loggingGuild.channels.fetch('1233853415952748645');
            if (loggingChannel) {
                await loggingChannel.send(`The squad **${squadName}** was disbanded by **${userId}**.`);
            }

            const successEmbed = new EmbedBuilder()
                .setTitle('Squad Disbanded')
                .setDescription(`Your squad **${squadName}** has been successfully disbanded.`)
                .setColor(0x00FF00);

            await interaction.editReply({ embeds: [successEmbed], ephemeral: true });
        } catch (error) {
            console.error('Error during the command execution:', error);
            await interaction.editReply({
                content: 'An error occurred while disbanding the squad. Please try again later.',
                ephemeral: true
            });
        }
    }
};