const { SlashCommandBuilder } = require('@discordjs/builders');
const { createCanvas, registerFont, loadImage } = require('canvas');
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const { getSheetsClient } = require('../../utils/sheets_cache');

const sheetId = '1XQ3kY7v8IaQzjk7jmUvoaOV2OZB6gFL0DcNlRNLQ8-I';
const BACKGROUND_IMAGE_URL = 'https://cdn.ballhead.app/web_assets/IMG_0421.png';
const ERROR_LOG_CHANNEL_ID = '1233853458092658749';
const ERROR_LOG_GUILD_ID = '1233740086839869501';

try {
    registerFont('./resources/Fonts/AntonSC-Regular.ttf', { family: 'Anton SC' });
    registerFont('./resources/Fonts/BebasNeue-Regular.ttf', { family: 'Bebas Neue' });
} catch (error) {
    console.error('Error loading fonts:', error);
}

// Draw rounded rectangle
function drawRoundedRect(ctx, x, y, width, height, radius, fillStyle, strokeStyle, lineWidth = 4) {
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

    if (fillStyle) {
        ctx.fillStyle = fillStyle;
        ctx.fill();
    }
    if (strokeStyle) {
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = strokeStyle;
        ctx.stroke();
    }
}

// Draw hexagon rank badge
function drawRankBadge(ctx, x, y, rank, size) {
    const colors = {
        1: { bg: '#FF6B00', border: '#FFAA00', text: '#FFFFFF', glow: '#FF6B00' },
        2: { bg: '#4A5568', border: '#A0AEC0', text: '#FFFFFF', glow: '#A0AEC0' },
        3: { bg: '#8B4513', border: '#CD7F32', text: '#FFFFFF', glow: '#CD7F32' },
        default: { bg: '#0F4C4C', border: '#14B8A6', text: '#FFFFFF', glow: '#14B8A6' }
    };

    const color = colors[rank] || colors.default;

    ctx.save();

    // Glow effect for top 3
    if (rank <= 3) {
        ctx.shadowColor = color.glow;
        ctx.shadowBlur = 12;
    }

    // Draw hexagon
    ctx.beginPath();
    const sides = 6;
    for (let i = 0; i < sides; i++) {
        const angle = (Math.PI * 2 * i) / sides - Math.PI / 2;
        const px = x + Math.cos(angle) * size;
        const py = y + Math.sin(angle) * size;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    }
    ctx.closePath();

    ctx.fillStyle = color.bg;
    ctx.fill();
    ctx.strokeStyle = color.border;
    ctx.lineWidth = 3;
    ctx.stroke();

    // Reset shadow
    ctx.shadowBlur = 0;

    // Rank number
    ctx.fillStyle = color.text;
    ctx.font = `bold ${size * 0.9}px "Anton SC", "Bebas Neue", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(rank.toString(), x, y + 1);

    ctx.restore();
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ranked-session-leaderboard')
        .setDescription('Displays the Ranked Session leaderboard showing player points'),

    async execute(interaction) {
        const sheets = await getSheetsClient();

        try {
            await interaction.deferReply();

            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: sheetId,
                range: 'Totals!A:B'
            });

            const rows = response.data.values;

            if (!rows || rows.length < 1) {
                return interaction.editReply({ content: 'No leaderboard data found.', ephemeral: true });
            }

            const data = rows.filter(row => row[0] && row[1] && !row[0].startsWith('#'));

            if (data.length === 0) {
                return interaction.editReply({ content: 'No leaderboard data found for this month.', ephemeral: true });
            }

            const sortedData = data
                .map(row => ({ name: row[0], points: parseInt(row[1]) || 0 }))
                .sort((a, b) => b.points - a.points);

            const top10 = sortedData.slice(0, 10);

            let backgroundImage;
            try {
                backgroundImage = await loadImage(BACKGROUND_IMAGE_URL);
            } catch (imgError) {
                console.error('Error loading background image:', imgError);
            }

            const canvas = createCanvas(1000, 1400);
            const ctx = canvas.getContext('2d');

            // === BACKGROUND ===
            if (backgroundImage) {
                ctx.drawImage(backgroundImage, 0, 0, canvas.width, canvas.height);
            } else {
                const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
                gradient.addColorStop(0, '#00B4B4');
                gradient.addColorStop(1, '#008080');
                ctx.fillStyle = gradient;
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }

            // === HEADER SECTION ===
            // Dark header bar
            ctx.fillStyle = 'rgba(5, 35, 35, 0.92)';
            ctx.fillRect(0, 0, canvas.width, 160);

            // Orange accent bar at bottom of header
            ctx.fillStyle = '#FF6B00';
            ctx.fillRect(0, 156, canvas.width, 4);

            // Main title
            ctx.save();
            ctx.font = 'bold 68px "Anton SC", "Bebas Neue", sans-serif';
            ctx.textAlign = 'center';

            // Title shadow
            ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
            ctx.fillText('RANKED SESSION', canvas.width / 2 + 3, 68);

            ctx.fillStyle = '#FFFFFF';
            ctx.fillText('RANKED SESSION', canvas.width / 2, 65);

            // Subtitle with orange
            ctx.font = 'bold 50px "Anton SC", "Bebas Neue", sans-serif';
            ctx.fillStyle = '#FF6B00';
            ctx.fillText('LEADERBOARD', canvas.width / 2, 120);
            ctx.restore();

            // Coaching Points pill
            ctx.save();
            const pillWidth = 220;
            const pillHeight = 36;
            const pillX = (canvas.width - pillWidth) / 2;
            const pillY = 168;

            // Pill background
            drawRoundedRect(ctx, pillX, pillY, pillWidth, pillHeight, 18, '#FF6B00', '#FFAA00', 2);

            ctx.font = 'bold 20px "Anton SC", "Bebas Neue", sans-serif';
            ctx.fillStyle = '#FFFFFF';
            ctx.textAlign = 'center';
            ctx.fillText('COACHING POINTS', canvas.width / 2, pillY + 24);
            ctx.restore();

            // === LEADERBOARD ENTRIES ===
            const startY = 220;
            const rowHeight = 90;
            const rowGap = 8;
            const rowWidth = 900;
            const rowX = 50;

            top10.forEach((player, index) => {
                const yPosition = startY + (index * (rowHeight + rowGap));
                const rank = index + 1;

                // Different styles for top 3 vs rest
                let containerBg, borderColor, pointsColor, borderWidth;

                if (rank === 1) {
                    // Gold/Orange - 1st place
                    containerBg = 'rgba(30, 20, 10, 0.88)';
                    borderColor = '#FF6B00';
                    pointsColor = '#FF6B00';
                    borderWidth = 4;
                } else if (rank === 2) {
                    // Silver - 2nd place
                    containerBg = 'rgba(25, 30, 35, 0.88)';
                    borderColor = '#94A3B8';
                    pointsColor = '#CBD5E1';
                    borderWidth = 3;
                } else if (rank === 3) {
                    // Bronze - 3rd place (reddish-brown)
                    containerBg = 'rgba(45, 25, 15, 0.88)';
                    borderColor = '#CD7F32';
                    pointsColor = '#DDA15E';
                    borderWidth = 3;
                } else {
                    // Teal - everyone else
                    containerBg = 'rgba(8, 45, 45, 0.85)';
                    borderColor = '#14B8A6';
                    pointsColor = '#2DD4BF';
                    borderWidth = 2;
                }

                // Row container
                ctx.save();

                // Glow effect for top 3
                if (rank <= 3) {
                    ctx.shadowColor = borderColor;
                    ctx.shadowBlur = 15;
                    ctx.shadowOffsetX = 0;
                    ctx.shadowOffsetY = 0;
                }

                drawRoundedRect(ctx, rowX, yPosition, rowWidth, rowHeight, 12, containerBg, borderColor, borderWidth);
                ctx.restore();

                // Inner highlight gradient for top 3
                if (rank <= 3) {
                    ctx.save();
                    ctx.globalAlpha = 0.15;
                    const innerGlow = ctx.createLinearGradient(rowX, yPosition, rowX, yPosition + rowHeight);
                    innerGlow.addColorStop(0, borderColor);
                    innerGlow.addColorStop(0.5, 'transparent');
                    ctx.fillStyle = innerGlow;
                    drawRoundedRect(ctx, rowX + 2, yPosition + 2, rowWidth - 4, rowHeight - 4, 10, innerGlow, null);
                    ctx.restore();
                }

                // Rank badge
                drawRankBadge(ctx, rowX + 55, yPosition + rowHeight / 2, rank, 26);

                // Player name
                ctx.save();
                ctx.font = 'bold 40px "Anton SC", "Bebas Neue", sans-serif';
                ctx.textAlign = 'left';

                // Text shadow
                ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
                const playerName = player.name.length > 18 ? player.name.substring(0, 15) + '...' : player.name;
                ctx.fillText(playerName.toUpperCase(), rowX + 100, yPosition + rowHeight / 2 + 12);

                ctx.fillStyle = '#FFFFFF';
                ctx.fillText(playerName.toUpperCase(), rowX + 98, yPosition + rowHeight / 2 + 10);
                ctx.restore();

                // Points section
                ctx.save();
                const pointsText = player.points.toString();

                // Points value
                ctx.font = 'bold 46px "Anton SC", "Bebas Neue", sans-serif';
                ctx.textAlign = 'right';

                // Glow for top 3 points
                if (rank <= 3) {
                    ctx.shadowColor = pointsColor;
                    ctx.shadowBlur = 10;
                }

                ctx.fillStyle = pointsColor;
                ctx.fillText(pointsText, rowX + rowWidth - 70, yPosition + rowHeight / 2 + 10);

                // Reset shadow
                ctx.shadowBlur = 0;

                // "PTS" label
                ctx.font = 'bold 22px "Anton SC", "Bebas Neue", sans-serif';
                ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
                ctx.fillText('PTS', rowX + rowWidth - 20, yPosition + rowHeight / 2 + 8);
                ctx.restore();
            });

            // === FOOTER SECTION ===
            const footerHeight = 80;
            const footerY = canvas.height - footerHeight;

            // Footer background
            ctx.fillStyle = 'rgba(5, 35, 35, 0.95)';
            ctx.fillRect(0, footerY, canvas.width, footerHeight);

            // Orange top accent
            ctx.fillStyle = '#FF6B00';
            ctx.fillRect(0, footerY, canvas.width, 3);

            // Footer text
            ctx.save();
            ctx.textAlign = 'center';

            ctx.font = 'bold 18px "Anton SC", "Bebas Neue", sans-serif';
            ctx.fillStyle = '#14B8A6';
            ctx.fillText('PASS A SESSION (5/10) = 1 POINT   •   TOP PERFORMER = +1 BONUS', canvas.width / 2, footerY + 32);

            ctx.font = 'bold 20px "Anton SC", "Bebas Neue", sans-serif';
            ctx.fillStyle = '#FFFFFF';
            ctx.fillText('REACH 10 POINTS TO EARN YOUR RANKING ROLE!', canvas.width / 2, footerY + 58);
            ctx.restore();

            const attachment = new AttachmentBuilder(canvas.toBuffer(), { name: 'ranked-session-leaderboard.png' });
            const leaderboardEmbed = new EmbedBuilder()
                .setTitle('Ranked Session Leaderboard')
                .setDescription('Top players earning points through coaching sessions')
                .setColor('#14B8A6')
                .setImage('attachment://ranked-session-leaderboard.png')
                .setTimestamp()
                .setFooter({ text: 'Ballhead Coaching', iconURL: 'https://ballhead.app/favicon.ico' });

            await interaction.editReply({ embeds: [leaderboardEmbed], files: [attachment] });

        } catch (error) {
            console.error('Error fetching ranked session leaderboard:', error);

            try {
                const errorGuild = await interaction.client.guilds.fetch(ERROR_LOG_GUILD_ID);
                const errorChannel = await errorGuild.channels.fetch(ERROR_LOG_CHANNEL_ID);
                const errorEmbed = new EmbedBuilder()
                    .setTitle('Error')
                    .setDescription(`An error occurred while fetching the ranked session leaderboard: ${error.message}`)
                    .setColor('#FF0000');

                await errorChannel.send({ embeds: [errorEmbed] });
            } catch (logError) {
                console.error('Failed to log error:', logError);
            }

            await interaction.editReply({
                content: 'An error occurred while fetching the leaderboard. The admins have been notified.',
                ephemeral: true
            });
        }
    }
};