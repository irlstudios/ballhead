'use strict';

// Interaction glue for the league officials + games loop (Phase 2). All the
// decisions live in utils/league_officials.js (pure) and db.js (atomic SQL);
// this module only wires Discord components to them. customId scheme (split on
// ':'): official:assign:<id>, official:deny:<id>, official:report:<id> (buttons),
// official:assignselect:<id> (select), official:denymodal:<id>,
// official:reportmodal:<id> (modals).

const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageFlags,
    ContainerBuilder,
    PermissionsBitField,
} = require('discord.js');
const logger = require('../utils/logger');
const { noticePayload, buildTextBlock } = require('../utils/ui');
const { LEAGUE_OFFICIALS_CHANNEL_ID } = require('../config/constants');
const {
    fetchLeagueById,
    fetchAvailableOfficials,
    fetchOfficialRequestById,
    assignOfficialRequest,
    denyOfficialRequest,
    completeOfficialRequestWithReport,
    getLeagueGamesSummary,
} = require('../db');
const {
    REQUEST_STATUS,
    canSubmitReport,
    isValidHttpUrl,
    buildRequestCardLines,
    buildGamesSummaryLine,
} = require('../utils/league_officials');

const SUBTITLE = 'League Officials';

function staffCanManage(interaction) {
    return Boolean(interaction.member?.permissions?.has(PermissionsBitField.Flags.ManageRoles));
}

// Reply on a not-yet-deferred interaction.
function ephemeralNotice(interaction, message, title) {
    return interaction.reply({ ...noticePayload(message, { title, subtitle: SUBTITLE }), ephemeral: true });
}

// Edit on a deferred interaction.
function editNotice(interaction, message, title) {
    return interaction.editReply(noticePayload(message, { title, subtitle: SUBTITLE }));
}

// --- ops card ---------------------------------------------------------------

function buildOpsCardComponents(request, leagueName, extraLines = []) {
    const container = new ContainerBuilder();
    const block = buildTextBlock({
        title: `Official Request #${request.id}`,
        subtitle: SUBTITLE,
        lines: [...buildRequestCardLines(request, { leagueName }), ...extraLines],
    });
    if (block) container.addTextDisplayComponents(block);

    const components = [container];
    // Assign/Deny only while still Pending; terminal cards carry no buttons.
    if (request.status === REQUEST_STATUS.PENDING) {
        components.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`official:assign:${request.id}`).setLabel('Assign').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`official:deny:${request.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger),
        ));
    }
    return components;
}

// Posts the initial request card to the ops channel; returns the message so the
// caller can persist its id.
async function postOfficialRequestCard(client, request, leagueName) {
    const channel = await client.channels.fetch(LEAGUE_OFFICIALS_CHANNEL_ID);
    return channel.send({ flags: MessageFlags.IsComponentsV2, components: buildOpsCardComponents(request, leagueName) });
}

async function updateOpsCard(client, request, leagueName, extraLines = []) {
    if (!request.ops_message_id) {
        return;
    }
    try {
        const channel = await client.channels.fetch(LEAGUE_OFFICIALS_CHANNEL_ID);
        const message = await channel.messages.fetch(request.ops_message_id);
        await message.edit({ flags: MessageFlags.IsComponentsV2, components: buildOpsCardComponents(request, leagueName, extraLines) });
    } catch (error) {
        logger.error(`[Officials] Failed to update ops card for request ${request.id}:`, error.message);
    }
}

// --- DMs --------------------------------------------------------------------

async function dmUser(client, userId, { title, subtitle, lines, components = [] }) {
    try {
        const user = await client.users.fetch(String(userId));
        const container = new ContainerBuilder();
        const block = buildTextBlock({ title, subtitle, lines });
        if (block) container.addTextDisplayComponents(block);
        await user.send({ flags: MessageFlags.IsComponentsV2, components: [container, ...components] });
    } catch (error) {
        logger.error(`[Officials] Failed to DM ${userId}:`, error.message);
    }
}

async function dmAssignedOfficial(client, request, leagueName) {
    const reportRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`official:report:${request.id}`).setLabel('Submit Report').setStyle(ButtonStyle.Primary),
    );
    await dmUser(client, request.assigned_official_id, {
        title: 'You have been assigned to officiate a game',
        subtitle: leagueName,
        lines: [
            `**Request:** #${request.id}`,
            `**Sport:** ${request.sport || 'Any'}`,
            `**Details:** ${request.match_details || 'None provided'}`,
            `**Proposed time:** ${request.proposed_time || 'Not specified'}`,
            '',
            'After the match, submit your report with the button below.',
        ],
        components: [reportRow],
    });
}

// --- button entry point -----------------------------------------------------

async function handleOfficialsButton(interaction) {
    const [, action, idStr] = interaction.customId.split(':');
    const requestId = parseInt(idStr, 10);
    if (action === 'assign') {
        return showAssignSelect(interaction, requestId);
    }
    if (action === 'deny') {
        return showDenyModal(interaction, requestId);
    }
    if (action === 'report') {
        return showReportModal(interaction, requestId);
    }
    logger.warn('[Officials] Unknown button action:', action);
}

async function showAssignSelect(interaction, requestId) {
    if (!staffCanManage(interaction)) {
        return ephemeralNotice(interaction, 'You do not have permission to assign officials.', 'Permission Denied');
    }
    const request = await fetchOfficialRequestById(requestId);
    if (!request) {
        return ephemeralNotice(interaction, 'This request no longer exists.', 'Not Found');
    }
    if (request.status !== REQUEST_STATUS.PENDING) {
        return ephemeralNotice(interaction, 'This request is no longer open for assignment.', 'Already Handled');
    }

    const officials = await fetchAvailableOfficials(request.sport);
    if (officials.length === 0) {
        return ephemeralNotice(
            interaction,
            `No active roster officials available for sport "${request.sport || 'Any'}". Add some with \`/official-roster add\`.`,
            'No Officials Available'
        );
    }

    const menu = new StringSelectMenuBuilder()
        .setCustomId(`official:assignselect:${requestId}`)
        .setPlaceholder('Select an official to assign')
        .addOptions(officials.map((o) => ({
            label: (o.discord_name || o.discord_id).toString().slice(0, 100),
            description: `Sport: ${o.sport || 'Any'}`.slice(0, 100),
            value: o.discord_id.toString(),
        })));

    const container = new ContainerBuilder();
    const block = buildTextBlock({
        title: 'Assign Official',
        subtitle: SUBTITLE,
        lines: [`Select an official for request #${requestId} (${request.sport || 'Any'}).`],
    });
    if (block) container.addTextDisplayComponents(block);

    await interaction.reply({
        flags: MessageFlags.IsComponentsV2,
        components: [container, new ActionRowBuilder().addComponents(menu)],
        ephemeral: true,
    });
}

async function showDenyModal(interaction, requestId) {
    if (!staffCanManage(interaction)) {
        return ephemeralNotice(interaction, 'You do not have permission to deny requests.', 'Permission Denied');
    }
    const modal = new ModalBuilder().setCustomId(`official:denymodal:${requestId}`).setTitle('Deny Official Request');
    const reason = new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Reason for denial')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(reason));
    await interaction.showModal(modal);
}

async function showReportModal(interaction, requestId) {
    const request = await fetchOfficialRequestById(requestId);
    const check = canSubmitReport(request, interaction.user.id);
    if (!check.ok) {
        return ephemeralNotice(interaction, check.message, check.title);
    }

    const modal = new ModalBuilder().setCustomId(`official:reportmodal:${requestId}`).setTitle(`Report: Request #${requestId}`);
    const proof = new TextInputBuilder()
        .setCustomId('proof').setLabel('Proof URL (video/screenshot)')
        .setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('https://...');
    const rules = new TextInputBuilder()
        .setCustomId('rules').setLabel('Rules doc URL (optional)')
        .setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('https://...');
    const score = new TextInputBuilder()
        .setCustomId('score').setLabel('Final score / result (optional)')
        .setStyle(TextInputStyle.Short).setRequired(false);
    const notes = new TextInputBuilder()
        .setCustomId('notes').setLabel('Notes (optional)')
        .setStyle(TextInputStyle.Paragraph).setRequired(false);
    modal.addComponents(
        new ActionRowBuilder().addComponents(proof),
        new ActionRowBuilder().addComponents(rules),
        new ActionRowBuilder().addComponents(score),
        new ActionRowBuilder().addComponents(notes),
    );
    await interaction.showModal(modal);
}

// --- select entry point -----------------------------------------------------

async function handleOfficialsSelect(interaction) {
    const [, action, idStr] = interaction.customId.split(':');
    if (action !== 'assignselect') {
        return;
    }
    if (!staffCanManage(interaction)) {
        return ephemeralNotice(interaction, 'You do not have permission to assign officials.', 'Permission Denied');
    }
    await interaction.deferReply({ ephemeral: true });

    const requestId = parseInt(idStr, 10);
    const officialId = interaction.values[0];

    const request = await fetchOfficialRequestById(requestId);
    if (!request) {
        return editNotice(interaction, 'This request no longer exists.', 'Not Found');
    }

    // Re-validate at assignment: the league may have gone inactive/disbanded.
    const league = await fetchLeagueById(request.league_id);
    if (!league || league.league_status !== 'Active') {
        return editNotice(interaction, 'This league is no longer active. Deny the request instead.', 'League Ineligible');
    }

    // Re-validate the picked official against the live roster: the select menu
    // may have been opened before the official was removed or their sport changed.
    const available = await fetchAvailableOfficials(request.sport);
    if (!available.some((o) => String(o.discord_id) === String(officialId))) {
        return editNotice(interaction, 'That official is no longer available for this sport. Re-open Assign to choose another.', 'Official Unavailable');
    }

    const assigned = await assignOfficialRequest(requestId, officialId, interaction.user.id);
    if (!assigned) {
        return editNotice(interaction, 'This request was already assigned or closed.', 'Already Handled');
    }

    logger.info(`[Officials] Request ${requestId} assigned to ${officialId} by ${interaction.user.id} (league ${league.league_id})`);
    await updateOpsCard(interaction.client, assigned, league.league_name);
    await dmAssignedOfficial(interaction.client, assigned, league.league_name);
    return editNotice(interaction, `Assigned <@${officialId}> to request #${requestId}. They have been DMed a report button.`, 'Official Assigned');
}

// --- modal entry point ------------------------------------------------------

async function handleOfficialsModal(interaction) {
    const [, action, idStr] = interaction.customId.split(':');
    const requestId = parseInt(idStr, 10);
    if (action === 'denymodal') {
        return handleDenySubmit(interaction, requestId);
    }
    if (action === 'reportmodal') {
        return handleReportSubmit(interaction, requestId);
    }
    logger.warn('[Officials] Unknown modal action:', action);
}

async function handleDenySubmit(interaction, requestId) {
    if (!staffCanManage(interaction)) {
        return ephemeralNotice(interaction, 'You do not have permission to deny requests.', 'Permission Denied');
    }
    await interaction.deferReply({ ephemeral: true });
    const reason = interaction.fields.getTextInputValue('reason');

    const denied = await denyOfficialRequest(requestId, reason, interaction.user.id);
    if (!denied) {
        return editNotice(interaction, 'This request is no longer open.', 'Already Handled');
    }

    logger.info(`[Officials] Request ${requestId} denied by ${interaction.user.id}`);
    const league = await fetchLeagueById(denied.league_id);
    await updateOpsCard(interaction.client, denied, league?.league_name);
    await dmUser(interaction.client, denied.requested_by, {
        title: 'Official Request Denied',
        subtitle: league?.league_name,
        lines: [`Your official request #${requestId} was denied.`, `**Reason:** ${reason}`],
    });
    return editNotice(interaction, `Request #${requestId} denied and the requester was notified.`, 'Request Denied');
}

async function handleReportSubmit(interaction, requestId) {
    await interaction.deferReply({ ephemeral: true });

    const request = await fetchOfficialRequestById(requestId);
    const check = canSubmitReport(request, interaction.user.id);
    if (!check.ok) {
        return editNotice(interaction, check.message, check.title);
    }

    const proofUrl = (interaction.fields.getTextInputValue('proof') || '').trim();
    const rulesDocUrl = (interaction.fields.getTextInputValue('rules') || '').trim();
    const score = (interaction.fields.getTextInputValue('score') || '').trim();
    const notes = (interaction.fields.getTextInputValue('notes') || '').trim();

    if (!isValidHttpUrl(proofUrl)) {
        return editNotice(interaction, 'Provide a valid http(s) proof link.', 'Invalid Proof Link');
    }
    if (rulesDocUrl && !isValidHttpUrl(rulesDocUrl)) {
        return editNotice(interaction, 'The rules doc link must be a valid http(s) URL.', 'Invalid Rules Link');
    }

    const completed = await completeOfficialRequestWithReport(requestId, interaction.user.id, { proofUrl, rulesDocUrl, score, notes });
    if (!completed) {
        return editNotice(interaction, 'This request has already been reported.', 'Already Reported');
    }

    logger.info(`[Officials] Request ${requestId} completed by ${interaction.user.id} (league ${completed.league_id})`);
    const league = await fetchLeagueById(completed.league_id);
    const summary = await getLeagueGamesSummary(completed.league_id);
    await updateOpsCard(interaction.client, completed, league?.league_name, [buildGamesSummaryLine(summary)]);
    await dmUser(interaction.client, completed.requested_by, {
        title: 'Game Verified',
        subtitle: league?.league_name,
        lines: [`Your official request #${requestId} is complete and the game is verified.`, buildGamesSummaryLine(summary)],
    });
    return editNotice(interaction, ['Report recorded. This game is now verified.', buildGamesSummaryLine(summary)], 'Report Submitted');
}

module.exports = {
    postOfficialRequestCard,
    handleOfficialsButton,
    handleOfficialsSelect,
    handleOfficialsModal,
};
