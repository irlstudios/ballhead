const { SlashCommandBuilder } = require('discord.js');
const { google } = require('googleapis');
const { createCanvas, loadImage, registerFont } = require('canvas');
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const credentials = require('../resources/secret.json');

const SHEET_ID = '104cwJ_kjPhgH43FEkLzA77sfyoSoIC1JzeDpT0LXvDg';
const SHEET_TAB = 'Sheet1';

try {
    registerFont('./resources/Fonts/AntonSC-Regular.ttf', { family: 'Anton SC' });
    registerFont('./resources/Fonts/BebasNeue-Regular.ttf', { family: 'Bebas Neue' });
} catch (error) {
    console.error('Error loading fonts:', error);
}

function authorize() {
    const { client_email, private_key } = credentials;
    const auth = new google.auth.JWT({
        email: client_email,
        key: private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
    });
    return auth;
}

async function getSheetData(auth) {
    const sheets = google.sheets({ version: 'v4', auth });
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: SHEET_TAB,
        });
        return response.data.values || [];
    } catch (error) {
        console.error('Error fetching data from Google Sheets:', error);
        throw new Error(`Failed to fetch data from Google Sheets: ${error.message}`);
    }
}

function calculateLikesByUser(sheetData) {
    const userLikes = {};
    sheetData.forEach(row => {
        const username = row[0];
        const likes = parseInt(row[3], 10) || 0;
        if (!userLikes[username]) {
            userLikes[username] = 0;
        }
        userLikes[username] += likes;
    });

    return Object.entries(userLikes).map(([username, likes]) => ({ username, likes }));
}

async function drawLeaderboardImage(data) {
    const canvasWidth = 800;
    const canvasHeight = 1200;
    const canvas = createCanvas(canvasWidth, canvasHeight);
    const ctx = canvas.getContext('2d');

    const backgroundImage = await loadImage('./resources/christmas-bg-2.png');
    ctx.drawImage(backgroundImage, 0, 0, canvasWidth, canvasHeight);

    ctx.font = 'bold 50px "Anton SC", sans-serif';
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.fillText('Christmas Contest Leaderboard', canvasWidth / 2, 80);

    const startX = 50;
    const startY = 150;
    const boxWidth = canvasWidth - 100;
    const boxHeight = 80;
    const boxSpacing = 20;
    const maxEntries = Math.min(10, data.length);

    data.slice(0, maxEntries).forEach((entry, index) => {
        const yPosition = startY + index * (boxHeight + boxSpacing);
        const rankColor = index === 0 ? '#FFD700' : index === 1 ? '#C0C0C0' : index === 2 ? '#CD7F32' : '#FFFFFF';

        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 2;
        ctx.strokeRect(startX, yPosition, boxWidth, boxHeight);

        ctx.fillStyle = rankColor;
        ctx.font = 'bold 30px "Bebas Neue", sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`#${index + 1} ${entry.username}`, startX + 20, yPosition + 40);

        ctx.textAlign = 'right';
        const likesText = `${entry.likes} Likes`;
        const maxLikesWidth = boxWidth - 40;
        if (ctx.measureText(likesText).width > maxLikesWidth) {
            ctx.font = 'bold 25px "Bebas Neue", sans-serif';
        }
        ctx.fillText(likesText, startX + boxWidth - 20, yPosition + 40);
    });

    return canvas.toBuffer();
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('christmas-leaderboard')
        .setDescription('Displays the top videos by likes for the Christmas contest.'),

    async execute(interaction) {
        const auth = authorize();

        try {
            await interaction.deferReply();
            const sheetData = await getSheetData(auth);

            if (sheetData.length < 2) {
                await interaction.editReply({ content: 'No data available for the leaderboard.' });
                return;
            }

            const data = calculateLikesByUser(sheetData.slice(1));

            const sortedData = data.sort((a, b) => b.likes - a.likes);

            const leaderboardImage = await drawLeaderboardImage(sortedData);
            const attachment = new AttachmentBuilder(leaderboardImage, { name: 'leaderboard.png' });

            const embed = new EmbedBuilder()
                .setTitle('🎄 Christmas Contest Leaderboard 🎄')
                .setColor('#FF4500')
                .setDescription('Here are the top videos using \n #gcwinterholiday24 with the most likes:')
                .setImage('attachment://leaderboard.png')
                .setFooter({ text: 'Merry Christmas from Gym Class VR!' });

            await interaction.editReply({ embeds: [embed], files: [attachment] });
        } catch (error) {
            console.error('Error generating leaderboard:', error);
            await interaction.editReply({
                content: 'An error occurred while generating the leaderboard. Please try again later.',
            });
        }
    },
};
