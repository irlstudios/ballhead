'use strict';

const {
    ContainerBuilder,
    TextDisplayBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageFlags,
} = require('discord.js');
const logger = require('../utils/logger');
const { getSheetsClient } = require('../utils/sheets_cache');
const { getAdapter } = require('../programs/reengagement/registry');
const { config } = require('../programs/reengagement/config');
const {
    insertReengagementResponse,
    getLatestReengagementOutreach,
} = require('../db');

const RESPONSES_TAB = 'Reengagement Responses';
const RESPONSES_HEADERS = ['Responded At', 'Program', 'User ID', 'In-Game Name', 'Last Season', 'Response', 'Reason', 'Would Return', 'Comments'];

const REASONS = [
    { value: 'burnout', label: 'Burned out' },
    { value: 'lost_interest', label: 'Lost interest' },
    { value: 'forgot', label: 'Forgot it existed' },
    { value: 'no_time', label: 'No time / schedule' },
    { value: 'game_changed', label: 'The game / rules changed' },
    { value: 'other', label: 'Other' },
];
const reasonLabel = (value) => REASONS.find((r) => r.value === value)?.label || value;

const text = (content) => new TextDisplayBuilder().setContent(content);
const container = (lines) => {
    const c = new ContainerBuilder().setAccentColor(config.FF_ACCENT_COLOR);
    lines.forEach((line) => c.addTextDisplayComponents(text(line)));
    return c;
};

// True for any interaction this handler owns.
const isReengagementInteraction = (customId) => typeof customId === 'string' && customId.startsWith('reengage:');

// --- Jump back in --------------------------------------------------------
async function handleJumpBackIn(interaction, client, program) {
    const adapter = getAdapter(program);
    if (!adapter) {
        return;
    }

    await interaction.update({
        flags: MessageFlags.IsComponentsV2,
        components: [container([
            `## Welcome back, ${interaction.user.username}.`,
            'Good to have you back in the mix.',
            `Sign back up here: ${adapter.registerLink}`,
            adapter.nextSessionInfo,
        ])],
    }).catch((err) => logger.error(`[Reengage] Failed to update jump message: ${err.message}`));

    await insertReengagementResponse({ userId: interaction.user.id, program, response: 'jump_back' })
        .catch((err) => logger.error(`[Reengage] Failed to record jump_back: ${err.message}`));

    // Notify staff in the program's thread.
    try {
        const outreach = await getLatestReengagementOutreach(interaction.user.id, program);
        const name = outreach?.in_game_name || interaction.user.username;
        const lastSeason = outreach?.last_active_season ? ` (last played Season ${outreach.last_active_season})` : '';
        const thread = await client.channels.fetch(adapter.staffThreadId);
        await thread.send({
            flags: MessageFlags.IsComponentsV2,
            components: [container([
                `## Returning ${adapter.label} player`,
                `<@${interaction.user.id}> (${name})${lastSeason} just tapped **Jump back in**.`,
                'Reach out and help them get re-onboarded.',
            ])],
        });
    } catch (err) {
        logger.error(`[Reengage] Failed to post staff note: ${err.message}`);
    }
}

// --- Decline -> reason select -------------------------------------------
async function handleDecline(interaction, program) {
    const select = new StringSelectMenuBuilder()
        .setCustomId(`reengage:reason:${program}`)
        .setPlaceholder('What made you step away?')
        .addOptions(REASONS.map((r) => ({ label: r.label, value: r.value })));

    await interaction.update({
        flags: MessageFlags.IsComponentsV2,
        components: [
            container(['No worries. Mind sharing what made you step away? It helps us improve.']),
            new ActionRowBuilder().addComponents(select),
        ],
    }).catch((err) => logger.error(`[Reengage] Failed to show reason select: ${err.message}`));
}

// --- Reason select -> survey modal --------------------------------------
async function handleReasonSelect(interaction, program) {
    const reason = interaction.values[0];
    const modal = new ModalBuilder()
        .setCustomId(`reengage:survey:${program}:${reason}`)
        .setTitle('Quick exit survey')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('would_return')
                    .setLabel('What would bring you back?')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(false),
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('comments')
                    .setLabel('Anything else you want us to know?')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(false),
            ),
        );
    await interaction.showModal(modal);
}

// --- Survey modal submit ------------------------------------------------
async function mirrorResponseToSheet(row) {
    try {
        const sheets = await getSheetsClient();
        const meta = await sheets.spreadsheets.get({ spreadsheetId: config.FF_SHEET_ID });
        const exists = (meta.data.sheets || []).some((s) => s.properties.title === RESPONSES_TAB);
        if (!exists) {
            // A small grid is used deliberately: the FF workbook is near Google's
            // 10M-cell limit, so a default-size (1000x26) tab fails to create.
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: config.FF_SHEET_ID,
                resource: {
                    requests: [{
                        addSheet: {
                            properties: {
                                title: RESPONSES_TAB,
                                gridProperties: { rowCount: 1000, columnCount: RESPONSES_HEADERS.length },
                            },
                        },
                    }],
                },
            });
            await sheets.spreadsheets.values.update({
                spreadsheetId: config.FF_SHEET_ID,
                range: `${RESPONSES_TAB}!A1`,
                valueInputOption: 'RAW',
                resource: { values: [RESPONSES_HEADERS] },
            });
        }
        await sheets.spreadsheets.values.append({
            spreadsheetId: config.FF_SHEET_ID,
            range: `${RESPONSES_TAB}!A:I`,
            valueInputOption: 'USER_ENTERED',
            resource: { values: [row] },
        });
    } catch (err) {
        logger.error(`[Reengage] Failed to mirror response to sheet: ${err.message}`);
    }
}

async function handleSurveyModal(interaction, program, reason) {
    const wouldReturn = interaction.fields.getTextInputValue('would_return') || '';
    const comments = interaction.fields.getTextInputValue('comments') || '';

    // Acknowledge first. The DB write and (slower) sheet mirror below can exceed
    // Discord's 3-second interaction window; deferring keeps the token valid so
    // the closing edit does not fail with "Unknown interaction".
    try {
        await interaction.deferUpdate();
    } catch (err) {
        logger.error(`[Reengage] Failed to defer survey: ${err.message}`);
    }

    await insertReengagementResponse({
        userId: interaction.user.id,
        program,
        response: 'declined',
        reason,
        wouldReturn,
        comments,
    }).catch((err) => logger.error(`[Reengage] Failed to record decline: ${err.message}`));

    const outreach = await getLatestReengagementOutreach(interaction.user.id, program).catch(() => null);
    await mirrorResponseToSheet([
        new Date().toISOString(),
        program,
        interaction.user.id,
        outreach?.in_game_name || interaction.user.username,
        outreach?.last_active_season || '',
        'declined',
        reasonLabel(reason),
        wouldReturn,
        comments,
    ]);

    await interaction.editReply({
        flags: MessageFlags.IsComponentsV2,
        components: [container([
            'Thank you for the feedback, it genuinely helps.',
            'The door stays open if you ever change your mind.',
        ])],
    }).catch((err) => logger.error(`[Reengage] Failed to confirm survey: ${err.message}`));
}

// Single entry point; interactionHandler delegates here for any reengage: id.
async function handleReengagementInteraction(interaction, client) {
    const parts = interaction.customId.split(':');
    const action = parts[1];
    const program = parts[2];

    if (interaction.isButton() && action === 'jump') {
        return handleJumpBackIn(interaction, client, program);
    }
    if (interaction.isButton() && action === 'decline') {
        return handleDecline(interaction, program);
    }
    if (interaction.isStringSelectMenu() && action === 'reason') {
        return handleReasonSelect(interaction, program);
    }
    if (interaction.isModalSubmit() && action === 'survey') {
        return handleSurveyModal(interaction, program, parts[3]);
    }
    return undefined;
}

module.exports = {
    isReengagementInteraction,
    handleReengagementInteraction,
    REASONS,
    reasonLabel,
};
