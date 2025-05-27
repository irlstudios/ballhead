const { SlashCommandBuilder } = require('discord.js');
const { google } = require('googleapis');
const { createCanvas, registerFont } = require('canvas');
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const credentials = require('../resources/secret.json');

const sheetId = '1TF-JPBZ62Jqxe0Ilb_-GAe5xcOjQz-lE6NSFlrmNRvI';

try {
    registerFont('./resources/Fonts/AntonSC-Regular.ttf', { family: 'Anton SC' });
    registerFont('./resources/Fonts/BebasNeue-Regular.ttf', { family: 'Bebas Neue' });
} catch (error) {
    console.error('Error loading fonts:', error);
}

function authorize() {
    const { client_email, private_key } = credentials;
    const auth = new google.auth.JWT(
        client_email,
        null,
        private_key,
        ['https://www.googleapis.com/auth/spreadsheets.readonly']
    );
    return auth;
}

async function getRawSheetData(auth, range) {
    const sheets = google.sheets({ version: 'v4', auth });
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: sheetId,
            range,
        });
        return response.data.values || [];
    } catch (error) {
        console.error('Error fetching data from Sheets:', error);
        throw new Error(`Failed to fetch data from Google Sheets: ${error.message}`);
    }
}

function drawLeaderboardImage(squads, mode) {
    const canvasWidth = 800;
    const canvasHeight = 1200;
    const canvas = createCanvas(canvasWidth, canvasHeight);
    const ctx = canvas.getContext('2d');

    const gradient = ctx.createLinearGradient(0, 0, 0, canvasHeight);
    gradient.addColorStop(0, '#0f0c29');
    gradient.addColorStop(1, '#302b63');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    ctx.font = 'bold 45px "Anton SC", sans-serif';
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.fillText('Content Squad Leaderboard', canvasWidth / 2, 60);

    ctx.font = 'bold 30px "Bebas Neue", sans-serif';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(mode === 'last-week' ? "Last Week's Data" : "All-Time Data", canvasWidth / 2, 100);

    const startX = 50;
    const startY = 150;
    const boxWidth = canvasWidth - 100;
    const boxHeight = 80;
    const boxSpacing = 20;

    squads.forEach((squad, index) => {
        const yPosition = startY + index * (boxHeight + boxSpacing);
        const rankColor = index < 3 ? ['#FFD700', '#C0C0C0', '#CD7F32'][index] : '#FFFFFF';

        ctx.fillStyle = '#365577';
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 3;
        ctx.fillRect(startX, yPosition, boxWidth, boxHeight);
        ctx.strokeRect(startX, yPosition, boxWidth, boxHeight);

        ctx.fillStyle = rankColor;
        ctx.font = 'bold 30px "Bebas Neue", sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`#${index + 1} ${squad.squadName}`, startX + 20, yPosition + 50);

        ctx.textAlign = 'right';
        ctx.fillText(`${squad.totalPosts} Posts`, startX + boxWidth - 20, yPosition + 50);
    });

    return canvas.toBuffer();
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('content-squad-leaderboard')
        .setDescription('Displays the content squad leaderboard based on total posts')
        .addStringOption(option =>
            option.setName('mode')
                .setDescription('Choose the leaderboard mode')
                .setRequired(true)
                .addChoices(
                    { name: 'Last Week', value: 'last-week' },
                    { name: 'All-Time', value: 'all-time' },
                )
        ),

    async execute(interaction) {
        const auth = authorize();

        try {
            await interaction.deferReply({ ephemeral: false });

            const mode = interaction.options.getString('mode');

            let range = `'Total Posts Per Squad'!A1:ZZ`;
            const sheetData = await getRawSheetData(auth, range);

            if (sheetData.length < 2) {
                await interaction.editReply({ content: 'No data available for content squads.' });
                return;
            }

            const headers = sheetData[0];
            const squadsData = sheetData.slice(1);

            let relevantColumnIndex = -1;
            if (mode === 'last-week') {
                relevantColumnIndex = headers.length - 1;
                while (relevantColumnIndex > 0 && (!headers[relevantColumnIndex] || headers[relevantColumnIndex].trim() === '')) {
                    relevantColumnIndex--;
                }
                if (relevantColumnIndex <= 0) {
                    await interaction.editReply({ content: 'No weekly data available to display.', ephemeral: true });
                    return;
                }
            }

            const leaderboardData = squadsData.map(row => {
                const squadName = row[0];
                let totalPosts = 0;

                if (mode === 'all-time') {
                    const postsArray = row.slice(1).map(val => parseInt(val) || 0);
                    totalPosts = postsArray.reduce((total, posts) => total + posts, 0);
                } else if (mode === 'last-week') {
                    const lastWeekPosts = parseInt(row[relevantColumnIndex]) || 0;
                    totalPosts = lastWeekPosts;
                }

                return { squadName, totalPosts };
            });

            const filteredLeaderboard = leaderboardData.filter(squad => squad.totalPosts > 0);

            const sortedSquads = filteredLeaderboard.sort((a, b) => b.totalPosts - a.totalPosts);

            const topContentSquads = sortedSquads.slice(0, 10);

            if (topContentSquads.length === 0) {
                await interaction.editReply({ content: 'No data available for content squads.' });
                return;
            }

            const leaderboardImage = drawLeaderboardImage(topContentSquads, mode);
            const leaderboardAttachment = new AttachmentBuilder(leaderboardImage, { name: 'content_leaderboard.png' });

            const embed = new EmbedBuilder()
                .setTitle('Content Squad Leaderboard')
                .setColor('#0099ff')
                .setImage('attachment://content_leaderboard.png')
                .setTimestamp()
                .setFooter({ text: 'Content Leaderboard', iconURL: 'https://ballhead.app/squad-leaderboard' });

            await interaction.editReply({
                embeds: [embed],
                files: [leaderboardAttachment],
            });
        } catch (error) {
            console.error('Error generating content leaderboard:', error);
            await interaction.editReply({
                content: 'An error occurred while generating the content leaderboard. Please try again later.',
                ephemeral: true,
            });
        }
    },
};