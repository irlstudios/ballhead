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

const RANKED_COACH_ROLES = [
    '1273704152777883698',
    '1419458741006499961',
    '1312965840974643320',
    '1378911501712363701',
    '981933984453890059',
    '1317633044286406729',
];

const SHEET_ID = '1XQ3kY7v8IaQzjk7jmUvoaOV2OZB6gFL0DcNlRNLQ8-I';

function buildNotice({ title, subtitle, lines }) {
    const container = new ContainerBuilder();
    const block = buildTextBlock({ title, subtitle, lines });
            if (block) container.addTextDisplayComponents(block);
    return container;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ranked-session-best')
        .setDescription('Set the best participant for a ranked session')
        .addStringOption(option =>
            option
                .setName('session_id')
                .setDescription('Ranked session ID (from log-ranked-session)')
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName('best_participant')
                .setDescription('Best participant in-game name')
                .setRequired(true)
        ),
    async execute(interaction) {
        const hasRole = interaction.member?.roles?.cache?.some(role => RANKED_COACH_ROLES.includes(role.id));
        if (!hasRole) {
            const errorContainer = buildNotice({
                title: 'Access Denied',
                subtitle: 'Ranked Coaching Only',
                lines: ['You do not have permission to update ranked sessions.']});
            await interaction.reply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer], ephemeral: true });
            return;
        }

        const sessionId = interaction.options.getString('session_id', true).trim();
        const bestParticipant = interaction.options.getString('best_participant', true).trim();

        if (!sessionId || !bestParticipant) {
            const errorContainer = buildNotice({
                title: 'Missing Details',
                subtitle: 'Ranked Session',
                lines: ['Please provide both the session ID and best participant.']});
            await interaction.reply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer], ephemeral: true });
            return;
        }

        try {
            const sheets = await getSheetsClient();
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: SHEET_ID,
                range: 'Log!A:A'
            });

            const rows = response.data.values || [];
            const matchId = sessionId.toLowerCase();
            let rowIndex = -1;
            for (let i = 0; i < rows.length; i += 1) {
                const cell = (rows[i][0] || '').toString().trim().toLowerCase();
                if (cell === matchId) {
                    rowIndex = i + 1;
                    break;
                }
            }

            if (rowIndex === -1) {
                const errorContainer = buildNotice({
                    title: 'Session Not Found',
                    subtitle: 'Ranked Session',
                    lines: [`No session found for ID: ${sessionId}`]});
                await interaction.reply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer], ephemeral: true });
                return;
            }

            await sheets.spreadsheets.values.update({
                spreadsheetId: SHEET_ID,
                range: `Log!H${rowIndex}`,
                valueInputOption: 'USER_ENTERED',
                resource: { values: [[bestParticipant]] }
            });

            const successContainer = buildNotice({
                title: 'Best Participant Updated',
                subtitle: 'Ranked Session',
                lines: [`**Session ID:** ${sessionId}`, `**Best Participant:** ${bestParticipant}`]});
            await interaction.reply({ flags: MessageFlags.IsComponentsV2, components: [successContainer], ephemeral: true });
        } catch (error) {
            console.error('Error updating best participant:', error);
            const errorContainer = buildNotice({
                title: 'Update Failed',
                subtitle: 'Ranked Session',
                lines: ['There was an error updating the session. Please try again later.']});
            await interaction.reply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer], ephemeral: true });
        }
    }
};
