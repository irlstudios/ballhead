const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { google } = require('googleapis');
const { createCanvas, loadImage, registerFont } = require('canvas');
const credentials = require('../resources/secret.json');

const authorize = () => {
    const { client_email, private_key } = credentials;
    return new google.auth.JWT(
        client_email,
        null,
        private_key.replace(/\\n/g, '\n'),
        ['https://www.googleapis.com/auth/spreadsheets']
    );
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('playoffs_leaderboard')
        .setDescription('Display the leaderboard of teams with the most wins'),

    async execute(interaction) {
        const sheets = google.sheets({ version: 'v4', auth: authorize() });
        const spreadsheetId = '1oAvSbaP2Yo2R9PghLRgH_6hkE9yAdI6znnMVxji4NHg';
        const range = 'Mock Data!A:E';

        try {
            const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });
            const rows = response.data.values;

            if (!rows || rows.length === 0) {
                return interaction.reply('No data found in the sheet.');
            }

            const data = rows.slice(1).map(row => ({
                teamName: row[0],
                players: row[1],
                wins: parseInt(row[2], 10) || 0,
                score: parseFloat(row[3]) || 0,
                rank: parseInt(row[4], 10) || 0
            })).sort((a, b) => b.wins - a.wins);

            const canvas = createCanvas(1000, 800);
            const ctx = canvas.getContext('2d');

            // Enhanced Background
            const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
            gradient.addColorStop(0, '#0f0c29');
            gradient.addColorStop(0.5, '#302b63');
            gradient.addColorStop(1, '#24243e');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Semi-Transparent Overlay
            ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
            ctx.fillRect(50, 50, canvas.width - 100, canvas.height - 100);

            // Title Styling
            ctx.fillStyle = '#FFD700';
            ctx.font = 'bold 56px Bebas Neue';
            ctx.textAlign = 'center';
            ctx.shadowColor = 'black';
            ctx.shadowBlur = 10;
            ctx.fillText('🏆 Team Leaderboard', canvas.width / 2, 120);

            ctx.shadowBlur = 0; // Reset shadow

            // Headers
            ctx.fillStyle = '#FFD700';
            ctx.font = '30px Bebas Neue';
            ctx.fillText('Rank', 150, 180);
            ctx.fillText('Team Name', 400, 180);
            ctx.fillText('Wins', 700, 180);

            ctx.strokeStyle = '#FFD700';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(80, 200);
            ctx.lineTo(920, 200);
            ctx.stroke();

            // Render Top 10 Teams
            ctx.font = '26px Bebas Neue';
            data.slice(0, 10).forEach((team, index) => {
                const y = 250 + index * 50;
                ctx.fillStyle = index === 0 ? '#FFD700' : index === 1 ? '#C0C0C0' : index === 2 ? '#CD7F32' : '#FFFFFF';
                ctx.fillText(`#${index + 1}`, 150, y);
                ctx.fillText(team.teamName, 400, y);
                ctx.fillText(String(team.wins), 700, y);
            });

            const attachment = new AttachmentBuilder(canvas.toBuffer(), { name: 'leaderboard.png' });
            await interaction.reply({ files: [attachment] });

        } catch (error) {
            console.error('Error fetching data from Google Sheets:', error);
            await interaction.reply('Failed to generate the leaderboard.');
        }
    }
};
