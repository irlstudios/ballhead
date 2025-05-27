const { SlashCommandBuilder } = require('discord.js');
const { google } = require('googleapis');
const { createCanvas, registerFont } = require('canvas');
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const credentials = require('../resources/secret.json');

const compWinSheetId = '1nO8wK4p27DgbOHQhuFrYfg1y78AvjYmw7yGYato1aus';

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

function drawRoundedRect(ctx, x, y, width, height, radius, fillColor, borderColor) {
    ctx.fillStyle = fillColor;
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('comp-squad-leaderboard')
        .setDescription('Displays the competitive squad leaderboard based on total wins since squad creation'),

    async execute(interaction) {
        const auth = authorize();
        const sheets = google.sheets({ version: 'v4', auth });

        try {
            await interaction.deferReply({ ephemeral: false });

            const squadWinsResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: compWinSheetId,
                range: `'Squads + Aggregate Wins'!A1:ZZ`,
            });

            const squadWinsData = squadWinsResponse.data.values;
            if (!squadWinsData || squadWinsData.length < 2) {
                console.error('No data found in the Squad Wins sheet.');
                await interaction.editReply({ content: 'No squads have wins to display.' });
                return;
            }

            console.log("Processing squad wins data...");

            const squadTotalWinsMap = {};
            const headers = squadWinsData[0].slice(3);
            const squadRows = squadWinsData.slice(1);

            squadRows.forEach(row => {
                const squadName = row[0]?.trim();
                const squadType = row[1]?.trim();
                const squadMade = row[2]?.trim();
                const winsArray = row.slice(3);
                const totalWins = winsArray.reduce((total, wins) => total + (parseInt(wins) || 0), 0);

                if (squadName && squadType === 'Competitive') {
                    squadTotalWinsMap[squadName] = {
                        totalWins,
                        squadType,
                        squadMade,
                    };
                    console.log(`Squad: ${squadName} - Total Wins: ${totalWins} - Type: ${squadType}`);
                }
            });

            if (Object.keys(squadTotalWinsMap).length === 0) {
                await interaction.editReply({ content: 'No competitive squads have wins to display.' });
                return;
            }

            const squadDataArray = [];

            for (const [squadName, squadInfo] of Object.entries(squadTotalWinsMap)) {
                const { totalWins } = squadInfo;
                if (totalWins === 0) continue;

                const level = Math.floor(totalWins / 50) + 1;
                squadDataArray.push({ squadName, totalWins, level });
            }

            const squadsWithWins = squadDataArray.sort((a, b) => b.totalWins - a.totalWins).slice(0, 10);

            if (squadsWithWins.length === 0) {
                await interaction.editReply({ content: 'No competitive squads have wins to display.' });
                return;
            }

            const canvas = createCanvas(1000, 1400);
            const ctx = canvas.getContext('2d');

            const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
            gradient.addColorStop(0, '#141E30');
            gradient.addColorStop(1, '#243B55');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            ctx.font = 'bold 55px "Anton SC", "Bebas Neue", sans-serif';
            ctx.fillStyle = '#FFFFFF';
            ctx.textAlign = 'center';
            ctx.fillText('Competitive Squad Leaderboard', canvas.width / 2, 90);

            const rankColors = ['#FFD700', '#C0C0D0', '#CD7F32', '#FFFFFF'];
            const boxWidth = 900;
            const boxHeight = 90;
            const startX = 50;
            const startY = 180;
            const boxSpacing = 20;

            squadsWithWins.forEach((squad, index) => {
                const yPosition = startY + index * (boxHeight + boxSpacing);
                const color = rankColors[index] || '#FFFFFF';

                drawRoundedRect(ctx, startX, yPosition - 45, boxWidth, boxHeight, 20, '#365577', '#FFFFFF');

                ctx.font = 'bold 35px "Bebas Neue", sans-serif';
                ctx.fillStyle = color;
                ctx.textAlign = 'center';
                ctx.fillText(`#${index + 1} ${squad.squadName} - ${squad.totalWins} Wins - Level ${squad.level}`, canvas.width / 2, yPosition + 10);
            });

            const leaderboardImage = canvas.toBuffer();
            const leaderboardEmbed = new EmbedBuilder()
                .setTitle('Competitive Squad Leaderboard')
                .setColor('#0099ff')
                .setImage('attachment://squad_leaderboard.png')
                .setTimestamp()
                .setFooter({ text: 'Squad Leaderboard', iconURL: 'https://ballhead.app/squad-leaderboard' });

            await interaction.editReply({
                embeds: [leaderboardEmbed],
                files: [new AttachmentBuilder(leaderboardImage, { name: 'squad_leaderboard.png' })],
            });
        } catch (error) {
            console.error('Error fetching squad leaderboard:', error);
            await interaction.editReply({
                content: 'An error occurred while fetching the squad leaderboard. Please try again later.',
            });
        }
    },
};