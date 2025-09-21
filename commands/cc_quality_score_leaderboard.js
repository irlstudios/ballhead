const { SlashCommandBuilder } = require('@discordjs/builders');
const { google } = require('googleapis');
const { createCanvas, registerFont } = require('canvas');
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const credentials = require('../resources/secret.json');

const SHEET_ID = '1Ze84DPzXsdaGAsg_t5MJMbmvGJlF1Q03R-uJ-OdpfU0';

try {
    registerFont('/home/ubuntu/.fonts/AntonSC-Regular.ttf', { family: 'Anton SC' });
    registerFont('/home/ubuntu/.fonts/BebasNeue-Regular.ttf', { family: 'Bebas Neue' });
} catch (error) {
    console.error('Error loading fonts:', error);
}

function authorize() {
    const { client_email, private_key } = credentials;
    return new google.auth.JWT(
        client_email,
        null,
        private_key,
        ['https://www.googleapis.com/auth/spreadsheets.readonly']
    );
}

async function getSheetData() {
    const sheets = google.sheets({ version: 'v4', auth: authorize() });

    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Season 16 Posts',
    });

    const data = response.data.values || [];
    if (data.length === 0) {
        throw new Error('No data found in Season 16 Posts sheet.');
    }

    const headers = data[0];
    const rows = data.slice(1);

    const colIndexes = {
        userId: headers.indexOf('User ID'),
        platform: headers.indexOf('Platform'),
        username: headers.indexOf('authorMeta/name'),
        week: headers.indexOf('Week'),
        avgQuality: headers.indexOf('Average Quality'),
        totalPosts: headers.indexOf('Active that Week'),
        validPost: headers.indexOf('Valid Post'),
    };

    console.log('Column Indexes:', colIndexes);

    return { headers, rows, colIndexes };
}

function findRecentGradedWeeks(rows, colIndexes, maxWeeks) {
    const weekData = rows
        .map(row => parseInt(row[colIndexes.week]))
        .filter(week => !isNaN(week));

    const uniqueWeeksWithData = [...new Set(weekData)].sort((a, b) => b - a);

    console.log(`Found ${uniqueWeeksWithData.length} graded weeks:`, uniqueWeeksWithData);

    return uniqueWeeksWithData.slice(0, maxWeeks);
}

function calculateQualityScores(rows, colIndexes, recentWeeks) {
    const userScores = {};
    let skippedPosts = 0;
    let countedPosts = 0;

    rows.forEach((row, index) => {
        const weekNumber = parseInt(row[colIndexes.week]);
        let validPost = row[colIndexes.validPost]?.toLowerCase().trim();
        let avgQuality = parseFloat(row[colIndexes.avgQuality]);
        let numTotalPosts = parseInt(row[colIndexes.totalPosts]);
        let userId = row[colIndexes.userId]?.trim();
        let username = row[colIndexes.username]?.trim();
        let platform = row[colIndexes.platform]?.trim();

        if (!recentWeeks.includes(weekNumber)) {
            skippedPosts++;
            return;
        }

        if (validPost !== 'true') {
            console.log(`[SKIPPED] Row ${index + 1}: Invalid post.`);
            skippedPosts++;
            return;
        }

        if (isNaN(avgQuality)) {
            console.log(`[SKIPPED] Row ${index + 1}: avgQuality is NaN. Defaulting to 0.`);
            avgQuality = 0;
        }

        if (isNaN(numTotalPosts) || numTotalPosts <= 0) {
            console.log(`[FIXED] Row ${index + 1}: numTotalPosts is NaN or zero. Defaulting to 1.`);
            numTotalPosts = 1;
        }

        if (!userId) {
            console.log(`[SKIPPED] Row ${index + 1}: Missing user ID.`);
            skippedPosts++;
            return;
        }

        if (!userScores[userId]) {
            userScores[userId] = { username, platform, weightedQuality: 0, totalPosts: 0 };
        }

        userScores[userId].weightedQuality += avgQuality * numTotalPosts;
        userScores[userId].totalPosts += numTotalPosts;
        countedPosts++;
    });

    console.log(`✅ Total Counted Posts: ${countedPosts}`);
    console.log(`🚫 Total Skipped Posts: ${skippedPosts}`);

    return Object.values(userScores)
        .map(user => ({
            username: user.username || 'Unknown',
            platform: user.platform || 'Unknown',
            averageScore: (user.weightedQuality / user.totalPosts).toFixed(2)
        }))
        .sort((a, b) => b.averageScore - a.averageScore);
}

function drawLeaderboard(leaderboardData, weeksLabel) {
    const topUsers = leaderboardData.slice(0, 10);
    const canvasWidth = 1000;
    const canvasHeight = 250 + topUsers.length * 120;
    const canvas = createCanvas(canvasWidth, canvasHeight);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    ctx.fillStyle = '#FFA500';
    ctx.font = 'bold 60px "Anton SC"';
    ctx.textAlign = 'center';
    ctx.fillText(`Quality Score Leaderboard - ${weeksLabel}`, canvasWidth / 2, 100);

    ctx.font = 'bold 35px "Bebas Neue"';
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'left';
    ctx.fillText('Rank', 80, 200);
    ctx.fillText('Username', 250, 200);
    ctx.fillText('Platform', 600, 200);
    ctx.fillText('Avg Score', 850, 200);

    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(50, 220);
    ctx.lineTo(950, 220);
    ctx.stroke();

    const startY = 250;
    const containerHeight = 100;
    const containerWidth = 900;
    const containerX = 50;
    const containerRadius = 15;

    topUsers.forEach((user, index) => {
        const yPosition = startY + index * (containerHeight + 10);

        ctx.fillStyle = '#222';
        drawRoundedRect(ctx, containerX, yPosition, containerWidth, containerHeight, containerRadius);

        ctx.fillStyle = '#FFF';
        ctx.font = 'bold 40px "Bebas Neue"';
        ctx.fillText(`#${index + 1}`, containerX + 30, yPosition + containerHeight / 2 + 10);
        ctx.fillText(user.username, containerX + 180, yPosition + containerHeight / 2 + 10);

        ctx.font = 'bold 35px "Bebas Neue"';
        ctx.fillText(user.platform, containerX + 600, yPosition + containerHeight / 2 + 10);
        ctx.fillText(user.averageScore, containerX + 850, yPosition + containerHeight / 2 + 10);
    });

    return canvas.toBuffer();
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.arcTo(x + width, y, x + width, y + radius, radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.arcTo(x + width, y + height, x + width - radius, y + height, radius);
    ctx.lineTo(x + radius, y + height);
    ctx.arcTo(x, y + height, x, y + height - radius, radius);
    ctx.lineTo(x, y + radius);
    ctx.arcTo(x, y, x + radius, y, radius);
    ctx.closePath();
    ctx.fill();
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('quality-leaderboard')
        .setDescription('Displays the leaderboard for quality scores')
        .addStringOption(option =>
            option.setName('timeframe')
                .setDescription('Select leaderboard timeframe')
                .setRequired(true)
                .addChoices(
                    { name: 'Last Week (graded data)', value: '1' },
                    { name: 'Last Two Weeks (graded data)', value: '2' }
                )
        ),

    async execute(interaction) {
        try {
            await interaction.deferReply();
            const timeframe = parseInt(interaction.options.getString('timeframe'));
            const { headers, rows, colIndexes } = await getSheetData();

            const recentWeeks = findRecentGradedWeeks(rows, colIndexes, timeframe);

            if (recentWeeks.length === 0) {
                await interaction.editReply({ content: 'No graded data found in the last available weeks.' });
                return;
            }

            const leaderboardData = calculateQualityScores(rows, colIndexes, recentWeeks);

            if (leaderboardData.length === 0) {
                await interaction.editReply({ content: 'No quality scores found for the selected period.' });
                return;
            }

            const weeksLabel = `Weeks ${recentWeeks.join(', ')}`;
            const leaderboardImage = drawLeaderboard(leaderboardData, weeksLabel);
            const attachment = new AttachmentBuilder(leaderboardImage, { name: 'leaderboard.png' });

            const leaderboardEmbed = new EmbedBuilder()
                .setTitle(`Quality Score Leaderboard - ${weeksLabel}`)
                .setColor('#FFA500')
                .setImage('attachment://leaderboard.png')
                .setFooter({ text: `Requested by ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() })
                .setTimestamp();

            await interaction.editReply({ embeds: [leaderboardEmbed], files: [attachment] });

        } catch (error) {
            console.error(`Error generating leaderboard: ${error}`);
            await interaction.editReply({ content: 'An error occurred while generating the leaderboard.' });
        }
    },
};
