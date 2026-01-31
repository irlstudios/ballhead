const { SlashCommandBuilder } = require('@discordjs/builders');
const { createCanvas, registerFont } = require('canvas');
const { AttachmentBuilder, MessageFlags, ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, TextDisplayBuilder } = require('discord.js');
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

const sheetId = '1zjBhY8oBLOlxuSLpozy0M4WpV11Q83kvoxs74u4EjyM';
const tabName = 'S2 HRD Participants (Weekly)';

function buildNoticeContainer({ title, subtitle, lines}) {
    const container = new ContainerBuilder();
    const block = buildTextBlock({ title, subtitle, lines });
            if (block) container.addTextDisplayComponents(block);
    return container;
}

try {
    registerFont('./resources/Fonts/AntonSC-Regular.ttf', { family: 'Anton SC' });
    registerFont('./resources/Fonts/BebasNeue-Regular.ttf', { family: 'Bebas Neue' });
} catch (err) {
    console.warn('Font load failed, using default fonts:', err);
}

function drawTrophy(ctx, x, y, size, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.moveTo(x - size/2, y - size/2);
    ctx.quadraticCurveTo(x - size/2, y - size/3, x - size/3, y);
    ctx.lineTo(x - size/4, y + size/3);
    ctx.lineTo(x + size/4, y + size/3);
    ctx.lineTo(x + size/3, y);
    ctx.quadraticCurveTo(x + size/2, y - size/3, x + size/2, y - size/2);
    ctx.closePath();
    ctx.fill();

    ctx.fillRect(x - size/6, y + size/3, size/3, size/6);
    ctx.fillRect(x - size/4, y + size/2, size/2, size/8);

    ctx.restore();
}

function drawBaseball(ctx, x, y, radius) {
    ctx.save();

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    ctx.strokeStyle = '#e74c3c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.9, Math.PI * 0.25, Math.PI * 0.75);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.9, Math.PI * 1.25, Math.PI * 1.75);
    ctx.stroke();

    const stitchCount = 8;
    for (let i = 0; i < stitchCount; i++) {
        const angle1 = Math.PI * 0.25 + (Math.PI * 0.5 / stitchCount) * i;
        const angle2 = Math.PI * 1.25 + (Math.PI * 0.5 / stitchCount) * i;

        ctx.strokeStyle = '#e74c3c';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(angle1) * radius * 0.85, y + Math.sin(angle1) * radius * 0.85);
        ctx.lineTo(x + Math.cos(angle1) * radius * 0.95, y + Math.sin(angle1) * radius * 0.95);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(x + Math.cos(angle2) * radius * 0.85, y + Math.sin(angle2) * radius * 0.85);
        ctx.lineTo(x + Math.cos(angle2) * radius * 0.95, y + Math.sin(angle2) * radius * 0.95);
        ctx.stroke();
    }

    ctx.restore();
}

function drawStars(ctx, x, y, count, size, color) {
    ctx.save();
    ctx.fillStyle = color;
    const spacing = size * 2.5;
    const startX = x - (spacing * (count - 1)) / 2;

    for (let i = 0; i < count; i++) {
        const starX = startX + spacing * i;
        ctx.beginPath();
        for (let j = 0; j < 5; j++) {
            const angle = (Math.PI * 2 / 5) * j - Math.PI / 2;
            const innerAngle = angle + Math.PI / 5;
            const outerX = starX + Math.cos(angle) * size;
            const outerY = y + Math.sin(angle) * size;
            const innerX = starX + Math.cos(innerAngle) * size * 0.5;
            const innerY = y + Math.sin(innerAngle) * size * 0.5;

            if (j === 0) {
                ctx.moveTo(outerX, outerY);
            } else {
                ctx.lineTo(outerX, outerY);
            }
            ctx.lineTo(innerX, innerY);
        }
        ctx.closePath();
        ctx.fill();
    }
    ctx.restore();
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('hrd-leaderboard')
        .setDescription('Displays the home run derby weekly leaderboard'),
    async execute(interaction) {
        const sheets = await getSheetsClient();
        await interaction.deferReply();
        try {
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: sheetId,
                range: `'${tabName}'!A:ZZ`
            });
            const rows = response.data.values;
            if (!rows || rows.length < 2) {
                const emptyContainer = buildNoticeContainer({
                    title: 'No Leaderboard Data',
                    subtitle: 'Home Run Derby',
                    lines: ['No data found.']
                });
                return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [emptyContainer], ephemeral: true });
            }
            const headers = rows[0];
            const dataRows = rows.slice(1);
            const homeRunCols = headers
                .map((title, index) => ({ title, index }))
                .filter(col => /^Home Runs$/i.test(col.title))
                .map(col => col.index);
            const nameCols = headers
                .map((title, index) => ({ title, index }))
                .filter(col => /Participants$/i.test(col.title))
                .map(col => col.index);
            const idCols = headers
                .map((title, index) => ({ title, index }))
                .filter(col => /^Discord ID$/i.test(col.title))
                .map(col => col.index);
            const entries = dataRows.map(row => {
                let total = homeRunCols.reduce((sum, idx) => sum + (parseInt(row[idx]) || 0), 0);
                const name = row[nameCols[0]] || '';
                const discordId = row[idCols[0]] || '';
                return { name, discordId, total };
            }).filter(e => e.name);
            const sorted = entries.sort((a, b) => b.total - a.total).slice(0, 10);

            const entryHeight = 85;
            const headerHeight = 180;
            const footerHeight = 40;
            const canvas = createCanvas(1000, headerHeight + sorted.length * entryHeight + footerHeight);
            const ctx = canvas.getContext('2d');

            const bgGradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
            bgGradient.addColorStop(0, '#0a0e27');
            bgGradient.addColorStop(0.5, '#151931');
            bgGradient.addColorStop(1, '#1f2341');
            ctx.fillStyle = bgGradient;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            for (let i = 0; i < 50; i++) {
                ctx.fillStyle = `rgba(255, 255, 255, ${Math.random() * 0.03})`;
                ctx.beginPath();
                ctx.arc(
                    Math.random() * canvas.width,
                    Math.random() * canvas.height,
                    Math.random() * 2,
                    0,
                    Math.PI * 2
                );
                ctx.fill();
            }

            const headerGradient = ctx.createLinearGradient(0, 0, 0, headerHeight);
            headerGradient.addColorStop(0, 'rgba(255, 215, 0, 0.1)');
            headerGradient.addColorStop(1, 'rgba(255, 215, 0, 0)');
            ctx.fillStyle = headerGradient;
            ctx.fillRect(0, 0, canvas.width, headerHeight);

            ctx.save();
            ctx.shadowBlur = 20;
            ctx.shadowColor = '#ffd700';
            ctx.shadowOffsetY = 5;

            ctx.font = 'bold 52px "Anton SC"';
            const titleGradient = ctx.createLinearGradient(0, 30, 0, 90);
            titleGradient.addColorStop(0, '#ffd700');
            titleGradient.addColorStop(0.5, '#ffed4e');
            titleGradient.addColorStop(1, '#ffa500');
            ctx.fillStyle = titleGradient;
            ctx.textAlign = 'center';
            ctx.fillText('HOME RUN DERBY', canvas.width / 2, 70);

            ctx.font = 'bold 28px "Bebas Neue"';
            ctx.fillStyle = '#ffffff';
            ctx.shadowBlur = 10;
            ctx.shadowColor = '#ffffff';
            ctx.fillText('WEEKLY CHAMPIONS', canvas.width / 2, 105);
            ctx.restore();

            drawBaseball(ctx, 100, 70, 25);
            drawBaseball(ctx, canvas.width - 100, 70, 25);

            ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
            ctx.fillRect(0, headerHeight - 50, canvas.width, 50);

            ctx.font = 'bold 20px "Bebas Neue"';
            ctx.fillStyle = '#ffd700';
            ctx.textAlign = 'left';
            ctx.fillText('RANK', 50, headerHeight - 20);
            ctx.fillText('PLAYER', 150, headerHeight - 20);
            ctx.textAlign = 'right';
            ctx.fillText('HOME RUNS', canvas.width - 50, headerHeight - 20);
            ctx.textAlign = 'left';

            sorted.forEach((entry, i) => {
                const y = headerHeight + i * entryHeight;
                const isTopThree = i < 3;
                const isEven = i % 2 === 0;

                if (isEven) {
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
                    ctx.fillRect(0, y, canvas.width, entryHeight);
                }

                if (isTopThree) {
                    const glowColors = ['#ffd700', '#c0c0c0', '#cd7f32'];
                    const glowGradient = ctx.createLinearGradient(0, y, 0, y + entryHeight);
                    glowGradient.addColorStop(0, `${glowColors[i]}20`);
                    glowGradient.addColorStop(0.5, `${glowColors[i]}10`);
                    glowGradient.addColorStop(1, `${glowColors[i]}20`);
                    ctx.fillStyle = glowGradient;
                    ctx.fillRect(0, y, canvas.width, entryHeight);

                    ctx.fillStyle = glowColors[i];
                    ctx.fillRect(0, y, 8, entryHeight);

                    ctx.save();
                    ctx.shadowBlur = 15;
                    ctx.shadowColor = glowColors[i];
                    ctx.fillRect(0, y, 8, entryHeight);
                    ctx.restore();
                }

                const rankX = 50;
                const rankY = y + entryHeight / 2 + 12;

                if (isTopThree) {
                    const trophyColors = ['#ffd700', '#c0c0c0', '#cd7f32'];
                    drawTrophy(ctx, rankX, rankY - 15, 30, trophyColors[i]);
                } else {
                    ctx.font = 'bold 32px "Bebas Neue"';
                    ctx.fillStyle = '#ffffff';
                    ctx.textAlign = 'center';
                    ctx.fillText(`${i + 1}`, rankX, rankY);
                }

                ctx.font = `${isTopThree ? 'bold' : ''} 28px "Bebas Neue"`;
                ctx.fillStyle = isTopThree ? '#ffffff' : '#e0e0e0';
                ctx.textAlign = 'left';
                ctx.fillText(entry.name.toUpperCase(), 150, rankY);

                if (isTopThree && i === 0) {
                    drawStars(ctx, 150 + ctx.measureText(entry.name.toUpperCase()).width + 40, rankY - 10, 3, 8, '#ffd700');
                }

                const hrX = canvas.width - 120;
                const hrY = rankY;

                ctx.save();
                if (isTopThree) {
                    ctx.shadowBlur = 20;
                    ctx.shadowColor = '#e74c3c';
                }

                const hrGradient = ctx.createRadialGradient(hrX, hrY - 15, 0, hrX, hrY - 15, 35);
                hrGradient.addColorStop(0, '#ff6b6b');
                hrGradient.addColorStop(0.7, '#e74c3c');
                hrGradient.addColorStop(1, '#c92a2a');
                ctx.fillStyle = hrGradient;
                ctx.beginPath();
                ctx.arc(hrX, hrY - 15, 35, 0, Math.PI * 2);
                ctx.fill();

                ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
                ctx.lineWidth = 2;
                ctx.stroke();
                ctx.restore();

                ctx.font = 'bold 32px "Bebas Neue"';
                ctx.fillStyle = '#ffffff';
                ctx.textAlign = 'center';
                ctx.fillText(entry.total.toString(), hrX, hrY - 5);

                if (entry.total >= 50) {
                    ctx.save();
                    ctx.font = '18px "Bebas Neue"';
                    ctx.fillStyle = '#ffd700';
                    ctx.fillText('🔥', hrX + 50, hrY - 10);
                    ctx.restore();
                }
            });

            const footerGradient = ctx.createLinearGradient(0, canvas.height - footerHeight, 0, canvas.height);
            footerGradient.addColorStop(0, 'rgba(255, 215, 0, 0)');
            footerGradient.addColorStop(1, 'rgba(255, 215, 0, 0.1)');
            ctx.fillStyle = footerGradient;
            ctx.fillRect(0, canvas.height - footerHeight, canvas.width, footerHeight);

            const attachment = new AttachmentBuilder(canvas.toBuffer(), { name: 'hrd_leaderboard.png' });

            await interaction.editReply({
                flags: MessageFlags.IsComponentsV2,
                components: [
                    new TextDisplayBuilder().setContent('## Home Run Derby Weekly Leaderboard'),
                    new MediaGalleryBuilder().addItems(
                        new MediaGalleryItemBuilder().setURL('attachment://hrd_leaderboard.png')
                    ),
                    new TextDisplayBuilder().setContent('-# Keep smashing to climb the standings')
                ],
                files: [attachment]
            });
        } catch (error) {
            console.error(error);
            const errorContainer = buildNoticeContainer({
                title: 'Leaderboard Error',
                subtitle: 'Home Run Derby',
                lines: ['Failed to fetch leaderboard.']
            });
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer], ephemeral: true });
        }
    }
};
