const { google } = require('googleapis');
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const credentials = require('../resources/secret.json');

const SHEET_ID = '14J4LOdWDa2mzS6HzVBzAJgfnfi8_va1qOWVsxnwB-UM';
const FORM_RESPONSES_TAB = 'Form Responses 1';
const STATS_TAB = 'Stats';

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

async function fetchSheetData(auth, range) {
    const sheets = google.sheets({ version: 'v4', auth });
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: range
    });
    return response.data.values;
}

function getCurrentWeekIndex(dateRow) {
    const today = new Date();
    let closestDateIndex = -1;
    let closestDateDifference = Infinity;

    for (let i = 1; i < dateRow.length; i++) {
        const weekDate = new Date(dateRow[i]);
        const difference = Math.abs(weekDate - today);

        if (difference < closestDateDifference && weekDate <= today) {
            closestDateDifference = difference;
            closestDateIndex = i;
        }
    }

    return closestDateIndex;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('officials-status')
        .setDescription('Check your current grade and requirement'),
    async execute(interaction) {
        const discordName = interaction.user.username.toLowerCase();
        const auth = authorize();

        try {
            const formResponses = await fetchSheetData(auth, `${FORM_RESPONSES_TAB}!A:H`);
            const stats = await fetchSheetData(auth, `${STATS_TAB}!A:Q`);

            const dateRow = stats[0];
            const currentWeekIndex = getCurrentWeekIndex(dateRow);

            const gradeInfo = formResponses.find(row => row[1]?.toLowerCase() === discordName);
            const hostedInfo = gradeInfo
                ? `Video: ${gradeInfo[4] || '--'}\nScore: ${gradeInfo[7] || 'N/A'}`
                : 'No grading information found.';

            const statsInfo = stats.find(row => row[0]?.toLowerCase() === discordName);
            if (!gradeInfo && !statsInfo) {
                await interaction.reply('No grading or requirement information found for you.');
                return;
            }
            const requirementMet = statsInfo ? statsInfo[currentWeekIndex] || 'N/A' : 'N/A';
            const average = statsInfo ? statsInfo[currentWeekIndex + 1] || 'N/A' : 'N/A';

            const embed = new EmbedBuilder()
                .setTitle(`${interaction.user.username}'s Grade & Requirement Status`)
                .setColor(0x00FF00)
                .addFields(
                    { name: 'Grading Information', value: hostedInfo, inline: true },
                    { name: `Requirement Information (Week of ${dateRow[currentWeekIndex] || 'N/A'})`, value: `Requirement Met: ${requirementMet}\nAverage: ${average}`, inline: true }
                )
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
        } finally {
            console.log('status displayed')
        }
    }, catch (error) {
        console.error('Error fetching grade or requirement data:', error);
        interaction.reply('There was an error fetching your grade and requirement status.');
    }
};
