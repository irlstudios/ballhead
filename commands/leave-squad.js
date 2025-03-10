const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const credentials = require('../resources/secret.json');

const GUILD_ID = '752216589792706621';
const LOGGING_GUILD_ID = '1233740086839869501';
const LOGGING_CHANNEL_ID = '1233853415952748645';
const ERROR_LOG_CHANNEL_ID = '1233853458092658749';

function authorize() {
    const { client_email, private_key } = credentials;
    return new google.auth.JWT(client_email, null, private_key, ['https://www.googleapis.com/auth/spreadsheets']);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leave-squad')
        .setDescription('Leave your current squad'),

    async execute(interaction) {
        const userId = interaction.user.id;
        const username = interaction.user.username;

        const auth = authorize();
        const sheets = google.sheets({ version: 'v4', auth });

        try {
            const squadMembersResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k',
                range: 'Squad Members!A:D',
            });

            const squadMembersData = squadMembersResponse.data.values || [];
            const squadMembers = squadMembersData.slice(1);

            const userInSquad = squadMembers.find(row => row[1]?.trim() === userId);

            const squadLeadersResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k',
                range: 'Squad Leaders!A:C',
            });

            const squadLeadersData = squadLeadersResponse.data.values || [];
            const squadLeaders = squadLeadersData.slice(1);

            const userIsLeader = squadLeaders.find(row => row[1]?.trim() === userId);

            if (userIsLeader) {
                return interaction.reply({ content: 'Sorry, you cannot leave a squad that you own.', ephemeral: true });
            }

            if (!userInSquad) {
                return interaction.reply({ content: 'You are not in a squad.', ephemeral: true });
            }

            const squadName = userInSquad[2]?.trim();

            if (!squadName) {
                return interaction.reply({ content: 'Squad data appears corrupted. Contact an admin.', ephemeral: true });
            }

            console.log(`User ${username} is in squad: ${squadName}`);

            const userInSquadIndex = squadMembers.findIndex(row => row[1]?.trim() === userId);
            if (userInSquadIndex !== -1) {
                const sheetRowIndex = userInSquadIndex + 2;
                await sheets.spreadsheets.values.update({
                    spreadsheetId: '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k',
                    range: `Squad Members!A${sheetRowIndex}:D${sheetRowIndex}`,
                    valueInputOption: 'RAW',
                    resource: { values: [['', '', '', '']] },
                });
            }

            const allDataResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k',
                range: 'All Data!A:F',
            });

            const allDataValues = allDataResponse.data.values || [];
            const allData = allDataValues.slice(1);
            const userInAllDataIndex = allData.findIndex(row => row[1]?.trim() === userId);

            if (userInAllDataIndex !== -1) {
                const sheetRowIndex = userInAllDataIndex + 2;
                await sheets.spreadsheets.values.update({
                    spreadsheetId: '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k',
                    range: `All Data!C${sheetRowIndex}:D${sheetRowIndex}`,
                    valueInputOption: 'RAW',
                    resource: { values: [['N/A', 'N/A']] },
                });
            }

            const squadOwner = squadLeaders.find(row => row[2]?.trim() === squadName);
            if (squadOwner) {
                try {
                    const ownerUser = await interaction.client.users.fetch(squadOwner[1]);
                    const dmEmbed = new EmbedBuilder()
                        .setTitle('Member Left Squad')
                        .setDescription(`Hello ${squadOwner[0]},\n<@${userId}> has left your squad **[${squadName}]**.`)
                        .setColor('#FF0000');

                    await ownerUser.send({ embeds: [dmEmbed] });
                } catch (error) {
                    console.error(`Failed to DM squad leader: ${error.message}`);
                }
            }

            const loggingGuild = await interaction.client.guilds.fetch(LOGGING_GUILD_ID);
            const loggingChannel = await loggingGuild.channels.fetch(LOGGING_CHANNEL_ID);
            const logEmbed = new EmbedBuilder()
                .setTitle('Member Left Squad')
                .setDescription(`**${username}** has left the squad **[${squadName}]**.`)
                .setColor('#FF0000');

            await loggingChannel.send({ embeds: [logEmbed] });

            try {
                const guild = await interaction.client.guilds.fetch(GUILD_ID);
                const member = await guild.members.fetch(userId);
                await member.setNickname(null);
            } catch (error) {
                console.log(`Could not change nickname for ${userId}:`, error.message);
            }

            await interaction.reply({
                content: `You have successfully left the squad **[${squadName}]**.`,
                ephemeral: true,
            });

        } catch (error) {
            console.error(error);
            const errorGuild = await interaction.client.guilds.fetch(LOGGING_GUILD_ID);
            const errorChannel = await errorGuild.channels.fetch(ERROR_LOG_CHANNEL_ID);
            const errorEmbed = new EmbedBuilder()
                .setTitle('Error')
                .setDescription(`An error occurred: ${error.message}`)
                .setColor('#FF0000');

            await errorChannel.send({ embeds: [errorEmbed] });

            if (!interaction.replied) {
                interaction.reply({
                    content: 'An error occurred while processing your request.',
                    ephemeral: true,
                }).catch(console.error);
            }
        }
    },
};