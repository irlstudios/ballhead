'use strict';

const {
    SlashCommandBuilder, AttachmentBuilder, MessageFlags,
    TextDisplayBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder,
    ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
    ContainerBuilder,
} = require('discord.js');
const { createCanvas, registerFont } = require('canvas');
const { getSheetsClient, getCachedValues } = require('../../utils/sheets_cache');
const { SPREADSHEET_COMP_WINS, GYM_CLASS_GUILD_ID } = require('../../config/constants');
const { calculateSquadWins, getWeeklyWins } = require('../../utils/top_squad_sync');
const { getSquadLevel } = require('../../utils/squad_level_sync');
const logger = require('../../utils/logger');

try {
    registerFont('./resources/Fonts/AntonSC-Regular.ttf', { family: 'Anton SC' });
    registerFont('./resources/Fonts/BebasNeue-Regular.ttf', { family: 'Bebas Neue' });
} catch (error) {
    logger.error('Error loading fonts:', error);
}

const LEADERBOARD_VIEWS = [
    { label: 'All-Time Wins', value: 'all-time' },
    { label: 'Weekly Wins', value: 'weekly' },
    { label: 'Top Contributors', value: 'contributors' },
];
const DEFAULT_VIEW = 'all-time';

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

function buildSelectRow(selectedView) {
    const menu = new StringSelectMenuBuilder()
        .setCustomId('squad-leaderboard-select')
        .setPlaceholder('Select leaderboard view')
        .setMinValues(1)
        .setMaxValues(1);
    for (const view of LEADERBOARD_VIEWS) {
        menu.addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel(view.label)
                .setValue(view.value)
                .setDefault(view.value === selectedView)
        );
    }
    return new ActionRowBuilder().addComponents(menu);
}

function buildCanvas(title, subtitle, entries) {
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
    ctx.fillText(title, canvas.width / 2, 90);

    ctx.font = 'bold 35px "Anton SC", "Bebas Neue", sans-serif';
    ctx.fillStyle = '#FFD700';
    ctx.fillText(subtitle, canvas.width / 2, 140);

    const rankColors = ['#FFD700', '#C0C0D0', '#CD7F32', '#FFFFFF'];
    const boxWidth = 900;
    const boxHeight = 90;
    const startX = 50;
    const startY = 220;
    const boxSpacing = 20;

    entries.forEach((entry, index) => {
        const yPosition = startY + index * (boxHeight + boxSpacing);
        const color = rankColors[index] || '#FFFFFF';
        drawRoundedRect(ctx, startX, yPosition - 45, boxWidth, boxHeight, 20, '#365577', '#FFFFFF');

        ctx.font = 'bold 35px "Bebas Neue", sans-serif';
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.fillText(`#${index + 1} ${entry}`, canvas.width / 2, yPosition + 10);
    });

    return canvas.toBuffer();
}

function buildErrorContainer(message) {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`## Squad Leaderboard\n${message}`)
    );
    return container;
}

async function buildSquadLeaderboardPayload(view, client) {
    const sheets = await getSheetsClient();
    const normalizedView = LEADERBOARD_VIEWS.some(v => v.value === view) ? view : DEFAULT_VIEW;

    if (normalizedView === 'all-time') {
        const squadWins = await calculateSquadWins(sheets);
        const entries = [];

        for (const [name, data] of squadWins) {
            if (data.squadType !== 'Competitive' || data.totalWins === 0) continue;
            const level = getSquadLevel(data.totalWins);
            entries.push({ name, wins: data.totalWins, level });
        }

        entries.sort((a, b) => b.wins - a.wins);
        const top10 = entries.slice(0, 10);

        if (top10.length === 0) {
            return { errorContainer: buildErrorContainer('No competitive squads have wins to display.') };
        }

        const canvasEntries = top10.map(e => `${e.name} - ${e.wins} Wins - Level ${e.level}`);
        const imageBuffer = buildCanvas('Squad Leaderboard', 'All-Time Wins', canvasEntries);

        const container = new ContainerBuilder();
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent('## Squad Leaderboard - All-Time Wins')
        );
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL('attachment://squad_leaderboard.png')
            )
        );
        container.addActionRowComponents(buildSelectRow(normalizedView));

        return {
            components: [container],
            files: [new AttachmentBuilder(imageBuffer, { name: 'squad_leaderboard.png' })],
        };
    }

    if (normalizedView === 'weekly') {
        const { weeklyWins, weekLabel } = await getWeeklyWins(sheets);
        const squadWins = await calculateSquadWins(sheets);
        const entries = [];

        for (const [name, weekly] of weeklyWins) {
            const data = squadWins.get(name);
            if (!data || data.squadType !== 'Competitive' || weekly === 0) continue;
            entries.push({ name, weeklyWins: weekly, totalWins: data.totalWins });
        }

        entries.sort((a, b) => b.weeklyWins - a.weeklyWins);
        const top10 = entries.slice(0, 10);

        if (top10.length === 0) {
            return { errorContainer: buildErrorContainer('No competitive squads have wins this week.') };
        }

        const canvasEntries = top10.map(e => `${e.name} - ${e.weeklyWins} Weekly / ${e.totalWins} Total`);
        const imageBuffer = buildCanvas('Squad Leaderboard', `Weekly Wins (${weekLabel})`, canvasEntries);

        const container = new ContainerBuilder();
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`## Squad Leaderboard - Weekly Wins (${weekLabel})`)
        );
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL('attachment://squad_leaderboard.png')
            )
        );
        container.addActionRowComponents(buildSelectRow(normalizedView));

        return {
            components: [container],
            files: [new AttachmentBuilder(imageBuffer, { name: 'squad_leaderboard.png' })],
        };
    }

    if (normalizedView === 'contributors') {
        const results = await getCachedValues({
            sheets,
            spreadsheetId: SPREADSHEET_COMP_WINS,
            ranges: ["'Squad Members'!A:ZZ"],
            ttlMs: 60000,
        });
        const membersRows = results.get("'Squad Members'!A:ZZ") || [];
        const membersData = membersRows.slice(1);

        const squadWins = await calculateSquadWins(sheets);

        // For each squad, find the top contributor
        const topContributors = new Map();

        for (const row of membersData) {
            if (!row || !row[0] || !row[1]) continue;
            const discordId = row[0];
            const squadName = row[1];
            let memberWins = 0;
            for (let i = 3; i < row.length; i++) {
                const val = parseInt(row[i], 10);
                if (!isNaN(val)) memberWins += val;
            }

            const data = squadWins.get(squadName);
            if (!data || data.squadType !== 'Competitive') continue;

            const existing = topContributors.get(squadName);
            if (!existing || memberWins > existing.wins) {
                topContributors.set(squadName, { discordId, wins: memberWins, squadName });
            }
        }

        const entries = [...topContributors.values()]
            .filter(e => e.wins > 0)
            .sort((a, b) => b.wins - a.wins)
            .slice(0, 10);

        if (entries.length === 0) {
            return { errorContainer: buildErrorContainer('No contributor data available.') };
        }

        // Resolve Discord usernames
        let guild = null;
        if (client) {
            guild = await client.guilds.fetch(GYM_CLASS_GUILD_ID).catch(() => null);
        }

        const canvasEntries = [];
        for (const entry of entries) {
            let displayName = entry.discordId;
            if (guild) {
                const member = await guild.members.fetch(entry.discordId).catch(() => null);
                if (member) displayName = member.displayName;
            }
            canvasEntries.push(`${entry.squadName} - ${displayName} (${entry.wins} Wins)`);
        }

        const imageBuffer = buildCanvas('Squad Leaderboard', 'Top Contributors', canvasEntries);

        const container = new ContainerBuilder();
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent('## Squad Leaderboard - Top Contributors')
        );
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL('attachment://squad_leaderboard.png')
            )
        );
        container.addActionRowComponents(buildSelectRow(normalizedView));

        return {
            components: [container],
            files: [new AttachmentBuilder(imageBuffer, { name: 'squad_leaderboard.png' })],
        };
    }

    return { errorContainer: buildErrorContainer('Unknown leaderboard view.') };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('squad-leaderboard')
        .setDescription('Displays the squad leaderboard'),

    async execute(interaction) {
        try {
            await interaction.deferReply();
            const result = await buildSquadLeaderboardPayload(DEFAULT_VIEW, interaction.client);

            if (result.errorContainer) {
                return interaction.editReply({
                    flags: MessageFlags.IsComponentsV2,
                    components: [result.errorContainer],
                });
            }

            await interaction.editReply({
                flags: MessageFlags.IsComponentsV2,
                components: result.components,
                files: result.files,
            });
        } catch (error) {
            logger.error('Error fetching squad leaderboard:', error);
            await interaction.editReply({
                flags: MessageFlags.IsComponentsV2,
                components: [buildErrorContainer('An error occurred. Please try again later.')],
            });
        }
    },

    buildSquadLeaderboardPayload,
    LEADERBOARD_VIEWS,
    DEFAULT_VIEW,
};
