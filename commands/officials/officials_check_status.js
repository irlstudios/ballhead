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

const SHEET_ID = '14J4LOdWDa2mzS6HzVBzAJgfnfi8_va1qOWVsxnwB-UM';
const FORM_RESPONSES_TAB = 'Form Responses 1';
const STATS_TAB = 'Stats';

async function fetchSheetData(sheets, range) {
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
        const sheets = await getSheetsClient();

        try {
            const formResponses = await fetchSheetData(sheets, `${FORM_RESPONSES_TAB}!A:H`);
            const stats = await fetchSheetData(sheets, `${STATS_TAB}!A:Q`);

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

            const statusContainer = new ContainerBuilder();
            const block = buildTextBlock({ title: `${interaction.user.username}'s Officials Status`,
                subtitle: 'Grades and weekly requirements', lines: [
                `**Grading Information**\n${hostedInfo}`,
                `**Requirement Information (Week of ${dateRow[currentWeekIndex] || 'N/A' })**\nRequirement Met: ${requirementMet}\nAverage: ${average}`
            ] });
            if (block) statusContainer.addTextDisplayComponents(block);

            await interaction.reply({ flags: MessageFlags.IsComponentsV2, components: [statusContainer] });
        } catch (error) {
            console.error('Error fetching grade or requirement data:', error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply('There was an error fetching your grade and requirement status.');
            } else {
                await interaction.editReply('There was an error fetching your grade and requirement status.');
            }
        } finally {
            console.log('status displayed');
        }
    }
};
