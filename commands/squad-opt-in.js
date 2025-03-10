const { SlashCommandBuilder } = require('@discordjs/builders');
const { google } = require('googleapis');
const { EmbedBuilder } = require('discord.js');
const axios = require('axios');
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
        .setName('squad-opt-in')
        .setDescription('Opt into receiving squad invitations.'),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const userId = interaction.user.id;
        const auth = authorize();
        const sheets = google.sheets({ version: 'v4', auth });

        try {
            const allDataResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k',
                range: 'All Data!A:F',
            });

            const allData = allDataResponse.data.values || [];
            const userRow = allData.find(row => row[1] === userId);

            if (!userRow) {
                await interaction.editReply({ content: 'Your data could not be found. Please make sure you are registered.', ephemeral: true });
                return;
            }

            const userRowIndex = allData.indexOf(userRow) + 1;

            userRow[5] = 'TRUE';

            await sheets.spreadsheets.values.update({
                spreadsheetId: '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k',
                range: `All Data!A${userRowIndex}:F${userRowIndex}`,
                valueInputOption: 'USER_ENTERED',
                resource: {
                    values: [userRow]
                }
            });

            const successEmbed = new EmbedBuilder()
                .setTitle('Squad Invitation Opt-In')
                .setDescription('You have successfully opted in to receive squad invitations.')
                .setColor('#00FF00');

            await interaction.editReply({ embeds: [successEmbed], ephemeral: true });
        } catch (error) {
            console.error('Error during squad-opt-in command:', error);
            await interaction.editReply({ content: 'An error occurred while processing your request. Please try again later.', ephemeral: true });
        }
    }
};
