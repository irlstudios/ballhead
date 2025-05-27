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

const SPREADSHEET_ID = '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('squad-opt-in')
        .setDescription('Opt back into receiving squad invitations.'),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const userId = interaction.user.id;
        const auth = authorize();
        const sheets = google.sheets({ version: 'v4', auth });

        try {
            const range = 'All Data!A:H';
            const allDataResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: range,
            });

            const allData = allDataResponse.data.values || [];

            let dataRowIndex = -1;
            const userRow = allData.find((row, index) => {
                if (row && row.length > 1 && row[1] === userId.toString()) {
                    dataRowIndex = index;
                    return true;
                }
                return false;
            });

            if (!userRow || dataRowIndex === -1) {
                await interaction.editReply({
                    content: 'Your data could not be found in the system. If you believe this is an error, please contact an admin.',
                    ephemeral: true
                });
                return;
            }

            const sheetRowIndex = dataRowIndex + 1;

            const prefIndex = 7;

            if (userRow.length > prefIndex && userRow[prefIndex] === 'TRUE') {
                await interaction.editReply({
                    content: 'You are already opted in to receive squad invitations.',
                    ephemeral: true
                });
                return;
            }

            const updateRange = `All Data!H${sheetRowIndex}`;
            console.log(`Updating ${updateRange} to TRUE for user ${userId}`);

            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: updateRange,
                valueInputOption: 'RAW',
                requestBody: {
                    values: [['TRUE']]
                }
            }).catch(err => { throw new Error(`Sheet update failed: ${err.message}`); });

            const successEmbed = new EmbedBuilder()
                .setTitle('Squad Invitation Opt-In')
                .setDescription('You have successfully opted back in to receive squad invitations.')
                .setColor('#00FF00')
                .setTimestamp();

            await interaction.editReply({ embeds: [successEmbed], ephemeral: true });

        } catch (error) {
            console.error(`Error during squad-opt-in command for ${userId}:`, error);

            await interaction.editReply({
                content: 'An error occurred while processing your request. Please try again later.',
                ephemeral: true
            });
        }
    }
};