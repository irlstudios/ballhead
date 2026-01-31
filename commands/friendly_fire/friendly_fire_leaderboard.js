const { SlashCommandBuilder } = require('@discordjs/builders');
const { createCanvas, registerFont } = require('canvas');
const { AttachmentBuilder, MessageFlags, ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, TextDisplayBuilder, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
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

const sheetId = '1yxGmKTN27i9XtOefErIXKgcbfi1EXJHYWH7wZn_Cnok';
const ERROR_LOG_CHANNEL_ID = '1233853458092658749';
const ERROR_LOG_GUILD_ID = '1233740086839869501';
const FF_LEADERBOARD_CATEGORIES = [
    { label: 'Player Rating (MMR)', value: 'MMR' },
    { label: 'Points', value: 'Points' },
    { label: 'Blocks', value: 'Blocks' },
    { label: 'Steals', value: 'Steals' },
    { label: 'Wins', value: 'Wins' },
    { label: 'Games Played', value: 'Games Played' }
];
const FF_LEADERBOARD_DEFAULT_CATEGORY = 'MMR';

function buildNoticeContainer({ title, subtitle, lines}) {
    const container = new ContainerBuilder();
    const block = buildTextBlock({ title, subtitle, lines });
            if (block) container.addTextDisplayComponents(block);
    return container;
}

try {
    registerFont('./resources/Fonts/AntonSC-Regular.ttf', { family: 'Anton SC' });
    registerFont('./resources/Fonts/BebasNeue-Regular.ttf', { family: 'Bebas Neue' });
} catch (error) {
    console.error('Error loading fonts:', error);
}

function drawRoundedRect(ctx, x, y, width, height, radius, fillStyle, strokeStyle) {
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

    ctx.fillStyle = fillStyle;
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = strokeStyle;
    ctx.stroke();
}

function buildLeaderboardSelectRow(selectedCategory) {
    const menu = new StringSelectMenuBuilder()
        .setCustomId('ff-leaderboard-select')
        .setPlaceholder('Select leaderboard category')
        .setMinValues(1)
        .setMaxValues(1);
    FF_LEADERBOARD_CATEGORIES.forEach((category) => {
        menu.addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel(category.label)
                .setValue(category.value)
                .setDefault(category.value === selectedCategory)
        );
    });
    return new ActionRowBuilder().addComponents(menu);
}

async function buildFriendlyFireLeaderboardPayload(category) {
    const normalizedCategory = FF_LEADERBOARD_CATEGORIES.some(option => option.value === category)
        ? category
        : FF_LEADERBOARD_DEFAULT_CATEGORY;
    const categoryLabel = FF_LEADERBOARD_CATEGORIES.find(option => option.value === normalizedCategory)?.label || normalizedCategory;
    const sheets = await getSheetsClient();

    const sheetInfo = await sheets.spreadsheets.get({
        spreadsheetId: sheetId
    });

    const tabs = sheetInfo.data.sheets.map(sheet => sheet.properties.title);
    const currentSeasonTab = tabs
        .filter(tab => (tab.startsWith('Season') || tab.match(/Season \d+ Week \d+/)) && !tab.includes('Media'))
        .sort()
        .reverse()[0];

    if (!currentSeasonTab) {
        return {
            errorContainer: buildNoticeContainer({
                title: 'No Season Data',
                subtitle: 'Friendly Fire',
                lines: ['No valid season tab found.']
            })
        };
    }

    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: `${currentSeasonTab}!A:J`
    });

    const rows = response.data.values || [];
    const headers = rows[0] || [];
    const data = rows.slice(1);

    const categoryIndex = headers.indexOf(normalizedCategory);
    if (categoryIndex === -1) {
        return {
            errorContainer: buildNoticeContainer({
                title: 'Category Not Found',
                subtitle: 'Friendly Fire',
                lines: [`Category ${normalizedCategory} not found.`]
            })
        };
    }

    const sortedData = data.sort((a, b) => parseFloat(b[categoryIndex]) - parseFloat(a[categoryIndex]));
    const top10 = sortedData.slice(0, 10);

    const canvas = createCanvas(1000, 1400);
    const ctx = canvas.getContext('2d');

    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#4B0082');
    gradient.addColorStop(1, '#8A2BE2');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.font = 'bold 60px "Anton SC", "Bebas Neue", sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
    ctx.shadowBlur = 5;
    ctx.fillText(`${categoryLabel} Leaderboard`, 50, 80);

    ctx.font = 'bold 50px "Anton SC", "Bebas Neue", sans-serif';
    ctx.fillStyle = '#FFD700';
    ctx.fillText(`Friendly Fire ${currentSeasonTab}`, 50, 150);

    ctx.font = 'bold 50px "Anton SC", "Bebas Neue", sans-serif';
    top10.forEach((player, index) => {
        const rankColor = index === 0 ? '#FFD700' : index === 1 ? '#C0C0C0' : index === 2 ? '#CD7F32' : '#ffffff';
        ctx.fillStyle = rankColor;
        ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
        ctx.shadowOffsetX = 1;
        ctx.shadowOffsetY = 1;
        ctx.shadowBlur = 2;

        const yPosition = 250 + (index * 110);

        const containerGradient = ctx.createLinearGradient(0, yPosition - 50, 0, yPosition + 50);
        containerGradient.addColorStop(0, '#6A0DAD');
        containerGradient.addColorStop(1, '#8A2BE2');

        drawRoundedRect(ctx, 40, yPosition - 50, 920, 100, 15, containerGradient, rankColor);

        ctx.fillStyle = rankColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`#${index + 1} ${player[0]} - ${player[categoryIndex]} ${normalizedCategory}`, 500, yPosition);
    });

    const attachment = new AttachmentBuilder(canvas.toBuffer(), { name: 'leaderboard.png' });

    const container = new ContainerBuilder();
    const block = buildTextBlock({
        title: `${categoryLabel} Leaderboard`,
        subtitle: `# Friendly Fire ${currentSeasonTab}`
    });
    if (block) container.addTextDisplayComponents(block);
    container.addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(
            new MediaGalleryItemBuilder().setURL('attachment://leaderboard.png')
        )
    );
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent('# Select another category:')
    );
    container.addActionRowComponents(buildLeaderboardSelectRow(normalizedCategory));

    return {
        components: [container],
        files: [attachment]
    };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ff-leaderboard')
        .setDescription('Displays the Friendly Fire leaderboard'),

    async execute(interaction) {
        try {
            await interaction.deferReply();
            const result = await buildFriendlyFireLeaderboardPayload(FF_LEADERBOARD_DEFAULT_CATEGORY);
            if (result.errorContainer) {
                return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [result.errorContainer], ephemeral: true });
            }
            await interaction.editReply({
                flags: MessageFlags.IsComponentsV2,
                components: result.components,
                files: result.files
            });

        } catch (error) {
            console.error('Error fetching leaderboard:', error);

            try {
                const errorGuild = await interaction.client.guilds.fetch(ERROR_LOG_GUILD_ID);
                const errorChannel = await errorGuild.channels.fetch(ERROR_LOG_CHANNEL_ID);
                const errorContainer = new ContainerBuilder();
                const block = buildTextBlock({ title: 'Leaderboard Error',
                    subtitle: 'Friendly Fire leaderboard failed', lines: [`**Error:** ${error.message}`] });
            if (block) errorContainer.addTextDisplayComponents(block);

                await errorChannel.send({ flags: MessageFlags.IsComponentsV2, components: [errorContainer] });
            } catch (logError) {
                console.error('Failed to log error:', logError);
            }

            const errorContainer = buildNoticeContainer({
                title: 'Leaderboard Error',
                subtitle: 'Friendly Fire',
                lines: ['An error occurred while fetching the leaderboard.', 'The admins have been notified.']
            });
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer], ephemeral: true });
        }
    },
    buildFriendlyFireLeaderboardPayload,
    FF_LEADERBOARD_CATEGORIES,
    FF_LEADERBOARD_DEFAULT_CATEGORY,
    ERROR_LOG_CHANNEL_ID,
    ERROR_LOG_GUILD_ID
};
