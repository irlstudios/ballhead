const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');
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
                return interaction.editReply({
                    flags: MessageFlags.IsComponentsV2,
                    components: [new TextDisplayBuilder().setContent('Your signup was received! Stats will be linked to your Discord ID soon.')],
                    ephemeral: true
                });
            }
            if (user.id === interaction.user.id) {
                return interaction.editReply({
                    flags: MessageFlags.IsComponentsV2,
                    components: [
                        new TextDisplayBuilder().setContent('You haven\'t signed up yet.'),
                        new TextDisplayBuilder().setContent('Register here: https://forms.gle/DKLWrwU9BzBMiT9X7')
                    ],
                    ephemeral: true
                });
            } else {
                return interaction.editReply({
                    flags: MessageFlags.IsComponentsV2,
                    components: [new TextDisplayBuilder().setContent(`${user.username} hasn't signed up yet.`)],
                    ephemeral: true
                });
            }
        }

        const name = userRow[0] || 'Unknown';
        const points = userRow[1] || '0';
        const blocks = userRow[2] || '0';
        const steals = userRow[3] || '0';
        const wins = userRow[4] || '0';
        const gamesPlayed = userRow[5] || '0';
        const mmr = userRow[6] || '0';

        const statsContainer = new ContainerBuilder()
            .setAccentColor(0xFF6B00)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`## ${name}`),
                new TextDisplayBuilder().setContent(`MMR: **${mmr}**`)
            )
            .addSeparatorComponents(
                new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
            )
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent([
                    `**Points:** ${points}`,
                    `**Blocks:** ${blocks}`,
                    `**Steals:** ${steals}`
                ].join('\n')),
                new TextDisplayBuilder().setContent([
                    `**Wins:** ${wins}`,
                    `**Games:** ${gamesPlayed}`
                ].join('\n'))
            )
            .addSeparatorComponents(
                new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small)
            )
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`-# Friendly Fire ${latestSeason}`)
            );

        await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [statsContainer] });
    } };
