const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const credentials = require('../resources/secret.json');

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
        .setName('change-squad-name')
        .setDescription('Change the name of your squad if you are the squad leader.')
        .addStringOption(option =>
            option.setName('new-name')
                .setDescription('The new name for your squad. (1-4 alphanumeric characters)')
                .setRequired(true)),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const userId = interaction.user.id;
        const newSquadName = interaction.options.getString('new-name').toUpperCase();
        const guild = interaction.guild;

        const squadNamePattern = /^[A-Z0-9]{1,4}$/;
        if (!squadNamePattern.test(newSquadName)) {
            return interaction.editReply({
                content: 'Invalid squad name. The name must be between 1 and 4 alphanumeric characters.',
                ephemeral: true
            });
        }

        const auth = authorize();
        const sheets = google.sheets({ version: 'v4', auth });

        try {
            const squadLeadersResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k',
                range: 'Squad Leaders!A:C'
            });

            const squadMembersResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k',
                range: 'Squad Members!A:C'
            });

            const allDataResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k',
                range: 'All Data!A:F'
            });

            const squadLeaders = squadLeadersResponse.data.values || [];
            const squadMembers = squadMembersResponse.data.values || [];
            const allData = allDataResponse.data.values || [];

            const userSquadLeaderRow = squadLeaders.find(row => row[1] === userId);
            if (!userSquadLeaderRow) {
                return interaction.editReply({
                    content: 'You do not own a squad, so you cannot change the squad name.',
                    ephemeral: true
                });
            }

            const currentSquadName = userSquadLeaderRow[2];

            const isSquadNameTaken = squadLeaders.some(row => row[2] === newSquadName);
            if (isSquadNameTaken) {
                return interaction.editReply({
                    content: `The squad name ${newSquadName} is already in use. Please choose a different name.`,
                    ephemeral: true
                });
            }

            const updatedSquadLeaders = squadLeaders.map(row => {
                if (row[1] === userId) {
                    return [row[0], row[1], newSquadName];
                }
                return row;
            });

            const updatedSquadMembers = squadMembers.map(row => {
                if (row[2] === currentSquadName) {
                    return [row[0], row[1], newSquadName];
                }
                return row;
            });

            const updatedAllData = allData.map(row => {
                if (row[2] === currentSquadName) {
                    return [row[0], row[1], newSquadName, row[3], row[4], row[5]];
                }
                return row;
            });

            await sheets.spreadsheets.values.update({
                spreadsheetId: '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k',
                range: 'Squad Leaders!A:C',
                valueInputOption: 'RAW',
                resource: { values: updatedSquadLeaders }
            });

            await sheets.spreadsheets.values.update({
                spreadsheetId: '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k',
                range: 'Squad Members!A:C',
                valueInputOption: 'RAW',
                resource: { values: updatedSquadMembers }
            });

            await sheets.spreadsheets.values.update({
                spreadsheetId: '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k',
                range: 'All Data!A:F',
                valueInputOption: 'RAW',
                resource: { values: updatedAllData }
            });

            const squadMembersToUpdate = squadMembers.filter(row => row[2] === currentSquadName);
            for (const memberRow of squadMembersToUpdate) {
                const memberId = memberRow[1];
                const member = await guild.members.fetch(memberId).catch(() => null);
                if (member) {
                    const dmEmbed = new EmbedBuilder()
                        .setTitle('Squad Name Changed')
                        .setDescription(`The squad name has been changed to **${newSquadName}** by the squad leader.`)
                        .setColor(0x00FF00);
                    await member.send({ embeds: [dmEmbed] }).catch(() => null);

                    try {
                        await member.setNickname(`[${newSquadName}] ${member.user.username}`);
                    } catch (error) {
                        console.log(`Could not update nickname for ${memberId}:`, error.message);
                    }
                }
            }

            const leader = await guild.members.fetch(userId);
            if (leader) {
                try {
                    await leader.setNickname(`[${newSquadName}] ${leader.user.username}`);
                } catch (error) {
                    console.log(`Could not update nickname for ${userId}:`, error.message);
                }
            }

            const loggingChannel = await interaction.client.guilds.fetch('1233740086839869501')
                .then(guild => guild.channels.fetch('1233853415952748645'))
                .catch(() => null);

            if (loggingChannel) {
                await loggingChannel.send(`The squad **${currentSquadName}** has been renamed to **${newSquadName}** by **${interaction.user.username}**.`);
            }

            const successEmbed = new EmbedBuilder()
                .setTitle('Squad Name Changed')
                .setDescription(`Your squad name has been successfully changed to **${newSquadName}**.`)
                .setColor(0x00FF00);

            await interaction.editReply({ embeds: [successEmbed], ephemeral: true });
        } catch (error) {
            console.error('Error during the command execution:', error);
            await interaction.editReply({
                content: 'An error occurred while changing the squad name. Please try again later.',
                ephemeral: true
            });
        }
    }
};
