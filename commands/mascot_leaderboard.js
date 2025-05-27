const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const { createCanvas, loadImage, registerFont } = require('canvas');
const credentials = require('../resources/secret.json');

function authorize() {
    const { client_email, private_key } = credentials;
    const auth = new google.auth.JWT(
        client_email,
        null,
        private_key.replace(/\\n/g, '\n'),
        ['https://www.googleapis.com/auth/spreadsheets.readonly']
    );
    return auth;
}

try {
    console.log("Attempted font registration (if paths were provided).");
} catch (fontError) {
    console.warn("Could not register custom fonts. Using system defaults.", fontError.message);
}

function roundRect(ctx, x, y, width, height, radius) {
    if (typeof radius === 'undefined') { radius = 5; }
    if (typeof radius === 'number') { radius = { tl: radius, tr: radius, br: radius, bl: radius }; }
    else { const defaultRadius = { tl: 0, tr: 0, br: 0, bl: 0 }; for (const side in defaultRadius) { radius[side] = radius[side] || defaultRadius[side]; } }
    ctx.beginPath(); ctx.moveTo(x + radius.tl, y); ctx.lineTo(x + width - radius.tr, y); ctx.quadraticCurveTo(x + width, y, x + width, y + radius.tr);
    ctx.lineTo(x + width, y + height - radius.br); ctx.quadraticCurveTo(x + width, y + height, x + width - radius.br, y + height);
    ctx.lineTo(x + radius.bl, y + height); ctx.quadraticCurveTo(x, y + height, x, y + height - radius.bl); ctx.lineTo(x, y + radius.tl);
    ctx.quadraticCurveTo(x, y, x + radius.tl, y); ctx.closePath();
}

async function generateLeaderboardImage(data) {
    const canvasWidth = 1000;
    const topEntries = data.slice(0, 10);
    const headerHeight = 150;
    const footerHeight = 50;
    const rowHeight = 55;
    const startY = 210;
    const canvasHeight = headerHeight + (topEntries.length * rowHeight) + footerHeight;

    const canvas = createCanvas(canvasWidth, canvasHeight);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#1e1f26';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    roundRect(ctx, 40, 30, canvasWidth - 80, 100, 10);
    ctx.fill();
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 48px "Bebas Neue", sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#000000'; ctx.shadowBlur = 7; ctx.shadowOffsetY = 2;
    ctx.fillText('🏆 Playoffs Leaderboard 🏆', canvasWidth / 2, 95);
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

    const headerY = 180;
    ctx.fillStyle = '#BDC3C7';
    ctx.font = '28px "Bebas Neue", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Rank', 150, headerY);
    ctx.fillText('Team Name', 450, headerY);
    ctx.fillText('Score', 800, headerY);

    const cardPadding = 8;
    const cardWidth = canvasWidth - 140;
    const cardX = 70;

    topEntries.forEach((team, index) => {
        const cardY = startY + index * rowHeight;

        ctx.fillStyle = index === 0 ? 'rgba(201, 176, 55, 0.2)' :
            index === 1 ? 'rgba(180, 180, 180, 0.2)' :
                index === 2 ? 'rgba(173, 138, 86, 0.2)' :
                    'rgba(44, 62, 80, 0.5)';
        roundRect(ctx, cardX, cardY, cardWidth, rowHeight - cardPadding, 8);
        ctx.fill();

        if (index < 3) {
            ctx.strokeStyle = index === 0 ? '#FFDF00' : index === 1 ? '#C0C0C0' : '#CD7F32';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        const contentY = cardY + (rowHeight - cardPadding) / 2 + 9;

        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 28px "Bebas Neue", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`#${index + 1}`, 150, contentY);

        ctx.fillStyle = '#FFFFFF';
        ctx.font = '24px "Your Secondary Font", sans-serif';
        ctx.textAlign = 'center';
        const maxTeamNameWidth = 450;
        let teamNameText = team.teamName;
        if (ctx.measureText(teamNameText).width > maxTeamNameWidth) {
            while (ctx.measureText(teamNameText + '...').width > maxTeamNameWidth && teamNameText.length > 0) { teamNameText = teamNameText.slice(0, -1); }
            teamNameText += '...';
        }
        ctx.fillText(teamNameText, 450, contentY);

        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 28px "Bebas Neue", sans-serif';
        ctx.textAlign = 'center';
        const scoreString = Number.isInteger(team.normalizedScore) ? String(team.normalizedScore) : team.normalizedScore.toFixed(1);
        ctx.fillText(scoreString, 800, contentY);
    });

    ctx.fillStyle = '#AAAAAA';
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'center';

    return canvas.toBuffer();
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('playoffs_leaderboard')
        .setDescription('Displays the event playoff leaderboard based on normalized score.'),

    async execute(interaction) {
        await interaction.deferReply();

        const auth = authorize();
        const sheets = google.sheets({ version: 'v4', auth });

        const spreadsheetId = '1nO8wK4p27DgbOHQhuFrYfg1y78AvjYmw7yGYato1aus';
        const range = `'Playoffs Conf'!D:G`;

        try {
            const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });
            const rows = response.data.values;

            if (!rows || rows.length <= 1) {
                return interaction.editReply('No leaderboard data found in the sheet.');
            }

            const data = rows
                .slice(1)
                .map(row => ({
                    teamName: row[0]?.trim() || 'Unknown Team',
                    normalizedScore: parseFloat(row[3]) || 0
                }))
                .filter(team => team.teamName !== 'Unknown Team')
                .sort((a, b) => b.normalizedScore - a.normalizedScore);

            if (data.length === 0) {
                return interaction.editReply('No valid leaderboard data could be processed.');
            }

            const imageBuffer = await generateLeaderboardImage(data);

            const attachment = new AttachmentBuilder(imageBuffer, { name: 'playoffs-leaderboard.png' });
            await interaction.editReply({ files: [attachment] });

        } catch (error) {
            console.error('Error generating playoffs leaderboard:', error);
            await interaction.editReply({ content: 'Failed to generate the leaderboard due to an error.', ephemeral: true });
            try {
                const errorGuild = await interaction.client.guilds.fetch('1233740086839869501');
                const errorChannel = await errorGuild.channels.fetch('1233853458092658749');
                const errorEmbed = new EmbedBuilder().setTitle('Leaderboard Command Error').setDescription(`**Error:** ${error.message}`).setColor(0xFF0000).setTimestamp();
                await errorChannel.send({ embeds: [errorEmbed] });
            } catch (logError) { console.error("Failed to log leaderboard error:", logError); }
        }
    }
};