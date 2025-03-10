const {SlashCommandBuilder} = require('@discordjs/builders');
const {google} = require('googleapis');
const {EmbedBuilder} = require('discord.js');
const credentials = require('../resources/secret.json');
const moment = require('moment');

function authorize() {
    const {client_email, private_key} = credentials;
    const auth = new google.auth.JWT(
        client_email,
        null,
        private_key,
        ['https://www.googleapis.com/auth/spreadsheets']
    );
    return auth;
}

const sheets = google.sheets({version: 'v4', auth: authorize()});

const sheetId = '14QLqeuRPlMKdCU5w2jTv47cRxf90hfk7KXzkNdO8ac8';
const hostLeadIDs = ['852886206260707358', '579299881131311124', '781397829808553994'];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('refresh-host-sheet')
        .setDescription('Refreshes the Discord Host sheet for the new week.'),
    async execute(interaction) {
        const userId = interaction.user.id;

        if (!hostLeadIDs.includes(userId)) {
            await interaction.reply({content: 'You do not have permission to perform this action.', ephemeral: true});
            return;
        }

        try {
            await interaction.deferReply({ephemeral: true});

            const sheetInfo = await sheets.spreadsheets.get({
                spreadsheetId: sheetId,
            });

            const tabs = sheetInfo.data.sheets.map(sheet => sheet.properties.title);
            const latestTab = tabs.filter(tab => tab.startsWith('Week')).sort().reverse()[0];

            if (!latestTab) {
                await interaction.editReply({content: 'Could not find a valid tab to update.', ephemeral: true});
                return;
            }

            const latestWeekNumber = parseInt(latestTab.match(/Week (\d+)/)[1], 10);
            const newWeekNumber = latestWeekNumber + 1;

            const today = moment();
            const startOfNextWeek = today.day() === 0 ? today.add(1, 'week').startOf('week').add(1, 'day') : today.startOf('week').add(1, 'week').add(1, 'day');
            const endOfNextWeek = startOfNextWeek.clone().add(6, 'days');

            const newTabName = `Week ${newWeekNumber} (${startOfNextWeek.format('MM/DD')} - ${endOfNextWeek.format('MM/DD')})`;

            const sheetIdToUpdate = sheetInfo.data.sheets.find(sheet => sheet.properties.title === latestTab)?.properties?.sheetId;
            if (!sheetIdToUpdate) {
                await interaction.editReply({
                    content: 'Could not find the sheet ID for the latest tab.',
                    ephemeral: true
                });
                return;
            }

            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: sheetId,
                resource: {
                    requests: [
                        {
                            updateSheetProperties: {
                                properties: {
                                    sheetId: sheetIdToUpdate,
                                    title: newTabName,
                                },
                                fields: 'title',
                            },
                        },
                    ],
                },
            });

            await sheets.spreadsheets.values.clear({
                spreadsheetId: sheetId,
                range: `${newTabName}!D9:Q27`,
            });

            const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

            const dateValues = [];
            for (let i = 0; i < 7; i++) {
                const currentDate = startOfNextWeek.clone().add(i, 'days').format('dddd MM/DD');
                const cellRange = `${String.fromCharCode(68 + i * 2)}7:${String.fromCharCode(69 + i * 2)}8`;
                dateValues.push({
                    range: `${newTabName}!${cellRange}`,
                    values: [[currentDate]],
                });
            }

            await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: sheetId,
                resource: {
                    data: dateValues,
                    valueInputOption: 'USER_ENTERED',
                },
            });

            await interaction.editReply({
                content: `The host sheet has been successfully refreshed for **Week ${newWeekNumber}**!`,
                ephemeral: true
            });
        } catch (error) {
            console.error('Error refreshing the host sheet:', error);
            await interaction.editReply({
                content: 'There was an error refreshing the host sheet. Please try again later.',
                ephemeral: true
            });
        }
    },
};
