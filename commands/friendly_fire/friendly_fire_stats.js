const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
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

function buildNoticeContainer({ title, subtitle, lines}) {
    const container = new ContainerBuilder();
    const block = buildTextBlock({ title, subtitle, lines });
            if (block) container.addTextDisplayComponents(block);
    return container;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ff-stats')
        .setDescription('Get tournament stats for a user')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to look up')
                .setRequired(false)),
    async execute(interaction) {
        const interactionAgeMs = Date.now() - interaction.createdTimestamp;
        if (interactionAgeMs > 2500) {
            console.warn(`[ff-stats] Interaction too old to defer (${interactionAgeMs}ms).`);
            return;
        }
        try {
            await interaction.deferReply();
        } catch (error) {
            if (error?.code === 10062) {
                console.warn('[ff-stats] Interaction expired before deferReply.');
                return;
            }
            throw error;
        }

        const user = interaction.options.getUser('user') || interaction.user;
        const discordId = user.id;

        const sheets = await getSheetsClient();

        const metadata = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
        const seasonTabs = metadata.data.sheets
            .map(s => s.properties.title)
            .filter(t => /^Season \d+$/.test(t))
            .map(t => ({ title: t, num: parseInt(t.split(' ')[1], 10) }))
            .sort((a, b) => b.num - a.num);

        if (seasonTabs.length === 0) {
            const emptyContainer = buildNoticeContainer({
                title: 'No Season Data',

                lines: ['No valid season sheets found.']
            });
            return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [emptyContainer] });
        }

        const latestSeason = seasonTabs[0].title;
        const range = `'${latestSeason}'!A:H`;
        const sheet = await sheets.spreadsheets.values.get({
            spreadsheetId: sheetId,
            range });

        const rows = sheet.data.values;
        if (!rows || rows.length < 2) {
            const emptyContainer = buildNoticeContainer({
                title: 'Stats Unavailable',

                lines: ['The stats sheet is empty or invalid.']
            });
            return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [emptyContainer] });
        }

        const headers = rows[0];
        const dataRows = rows.slice(1);
        const discordIdIndex = headers.indexOf('DiscordID');

        const userRow = dataRows.find(row => row[discordIdIndex] === discordId);

        if (!userRow) {
            // Check the "Discord IDs" tab for pending signups
            const idSheet = await sheets.spreadsheets.values.get({
                spreadsheetId: sheetId,
                range: '\'Discord IDs\'!A:C' });
            const idRows = idSheet.data.values || [];
            const idIndex = 1;
            const pendingEntry = idRows.find(row => row[idIndex] === discordId);
            if (pendingEntry) {
                const pendingContainer = buildNoticeContainer({
                    title: 'Signup Received',
    
                    lines: ['Your stats have not been paired with your Discord ID yet, but we received your signup submission.']
                });
                return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [pendingContainer], ephemeral: true });
            }
            if (user.id === interaction.user.id) {
                const noticeContainer = buildNoticeContainer({
                    title: 'Signup Required',
    
                    lines: ['You have not signed up yet.', 'Please register here: https://forms.gle/DKLWrwU9BzBMiT9X7']
                });
                return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [noticeContainer], ephemeral: true });
            } else {
                const noticeContainer = buildNoticeContainer({
                    title: 'No Signup Found',
    
                    lines: [`${user.username} has not signed up yet.`]
                });
                return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [noticeContainer], ephemeral: true });
            }
        }

        const name = userRow[0] || 'Unknown';
        const points = userRow[1] || '0';
        const blocks = userRow[2] || '0';
        const steals = userRow[3] || '0';
        const wins = userRow[4] || '0';
        const gamesPlayed = userRow[5] || '0';
        const mmr = userRow[6] || '0';

        const statsContainer = new ContainerBuilder();
        const block = buildTextBlock({ title: `${name}'s Stats`,
            subtitle: `Friendly Fire ${latestSeason}`, lines: [
            `**MMR:** ${mmr}`,
            `**Points:** ${points}`,
            `**Blocks:** ${blocks}`,
            `**Steals:** ${steals}`,
            `**Wins:** ${wins}`,
            `**Games Played:** ${gamesPlayed}`
        ] });
            if (block) statsContainer.addTextDisplayComponents(block);

        await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [statsContainer] });
    } };
