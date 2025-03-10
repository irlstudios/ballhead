const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');

const auth = new google.auth.GoogleAuth({
    keyFile: 'resources/secret.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const LOGGING_GUILD_ID = '1233740086839869501';
const LOGGING_CHANNEL_ID = '1233853415952748645';
const ERROR_LOG_CHANNEL_ID = '1233853458092658749';

const compSquadLevelRoles = [
    '1288918067178508423',
    '1288918165417365576',
    '1288918209294237707',
    '1288918281343733842'
];

const contentSquadLevelRoles = [
    '1291090496869109762',
    '1291090569346682931',
    '1291090608315699229',
    '1291090760405356708'
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('remove-from-squad')
        .setDescription('Remove a member from your squad')
        .addUserOption(option =>
            option.setName('member')
                .setDescription('The member you\'d like to remove from your squad')
                .setRequired(true)),

    async execute(interaction) {
        try {
            await interaction.deferReply({ ephemeral: true });

            const client = await auth.getClient();
            const sheets = google.sheets({ version: 'v4', auth: client });
            const spreadsheetId = '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k';

            const allDataResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: spreadsheetId,
                range: 'All Data!A:F',
            });
            const allData = allDataResponse.data.values;

            const commandUserID = interaction.member.user.id;
            const commandUserSquadRow = allData.find(row => row[1] === commandUserID);
            if (!commandUserSquadRow) {
                await interaction.editReply({ content: "Error: Command user's squad not found.", ephemeral: true });
                return;
            }
            const commandUserSquad = commandUserSquadRow[2];
            const commandUserSquadType = commandUserSquadRow[3];

            const squadLeadersResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: spreadsheetId,
                range: 'Squad Leaders',
            });
            const squadLeaders = squadLeadersResponse.data.values;
            const squadOwner = squadLeaders.find(row => row[1] === commandUserID);
            if (!squadOwner) {
                await interaction.editReply({ content: "Error: You are not a squad owner.", ephemeral: true });
                return;
            }

            const memberID = interaction.options.getUser('member').id;
            if (commandUserID === memberID) {
                await interaction.editReply({
                    content: "You can't remove yourself from your own squad.",
                    ephemeral: true
                });
                return;
            }

            const squadMembersResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: spreadsheetId,
                range: 'Squad Members!A:D',
            });
            const squadMembers = squadMembersResponse.data.values;
            const memberSquadRow = squadMembers.find(row => row[1] === memberID);
            if (!memberSquadRow) {
                await interaction.editReply({ content: "Error: Member's squad not found.", ephemeral: true });
                return;
            }
            const memberSquad = memberSquadRow[2];

            if (commandUserSquad !== memberSquad && commandUserID !== memberID) {
                await interaction.editReply({
                    content: "You can only remove members from your own squad.",
                    ephemeral: true
                });
                return;
            }

            const memberRowIndex = squadMembers.indexOf(memberSquadRow) + 1;
            const clearRange = `Squad Members!A${memberRowIndex}:D${memberRowIndex}`;
            const clearRequest = {
                spreadsheetId: spreadsheetId,
                range: clearRange,
            };
            await sheets.spreadsheets.values.clear(clearRequest);

            const memberAllDataRow = allData.find(row => row[1] === memberID);
            if (memberAllDataRow) {
                memberAllDataRow[2] = 'N/A';
                memberAllDataRow[3] = 'N/A';
                const memberAllDataRowIndex = allData.indexOf(memberAllDataRow) + 1;
                await sheets.spreadsheets.values.update({
                    spreadsheetId: spreadsheetId,
                    range: `All Data!C${memberAllDataRowIndex}:D${memberAllDataRowIndex}`,
                    valueInputOption: 'USER_ENTERED',
                    requestBody: {
                        values: [[memberAllDataRow[2], memberAllDataRow[3]]],
                    },
                });
            }

            try {
                const guild = interaction.guild;
                const member = await guild.members.fetch(memberID);
                await member.setNickname(null);

                let rolesToRemove = [];
                if (commandUserSquadType === 'Competitive') {
                    rolesToRemove = compSquadLevelRoles;
                } else if (commandUserSquadType === 'Content') {
                    rolesToRemove = contentSquadLevelRoles;
                }

                if (rolesToRemove.length > 0) {
                    await member.roles.remove(rolesToRemove).catch(err => console.log(`Failed to remove roles from ${memberID}:`, err.message));
                }

            } catch (error) {
                console.log(`Could not reset nickname or remove roles for ${memberID}:`, error.message);
            }

            await interaction.editReply({
                content: `Member has been successfully removed from the squad.`,
                ephemeral: true
            });

            const loggingGuild = await interaction.client.guilds.fetch(LOGGING_GUILD_ID);
            const loggingChannel = await loggingGuild.channels.fetch(LOGGING_CHANNEL_ID);
            const logMessage = `**${commandUserID}** has removed **${memberID}** from **[${commandUserSquad}]**`;
            await loggingChannel.send(logMessage);
        } catch (error) {
            console.error('Error:', error);
            await interaction.editReply({
                content: 'An error occurred while processing your request. Please try again later.',
                ephemeral: true
            });

            try {
                const errorGuild = await interaction.client.guilds.fetch(LOGGING_GUILD_ID);
                const errorChannel = await errorGuild.channels.fetch(ERROR_LOG_CHANNEL_ID);
                const errorEmbed = new EmbedBuilder()
                    .setTitle('Error')
                    .setDescription(`An error occurred while executing the remove-from-squad command: ${error.message}`)
                    .setColor('#FF0000');
                await errorChannel.send({ embeds: [errorEmbed] });
            } catch (logError) {
                console.error('Failed to log error:', logError);
            }
        }
    }
};