'use strict';

// Interaction glue for league strike appeals (Phase 4). Appeal outcomes are a
// manual staff decision; this only wires the Accept/Reject controls to atomic
// DB transitions. customId scheme: appeal:accept:<id>, appeal:reject:<id>
// (buttons), appeal:rejectmodal:<id> (modal).

const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageFlags,
    ContainerBuilder,
    PermissionsBitField,
} = require('discord.js');
const logger = require('../utils/logger');
const { noticePayload, buildTextBlock } = require('../utils/ui');
const { LEAGUE_LOG_CHANNEL_ID } = require('../config/constants');
const {
    fetchStrikeById,
    resolveAppeal,
    acceptAppealAndLiftStrike,
    countActiveStrikes,
    setLeagueHealthStatus,
    fetchLeagueById,
} = require('../db');
const { deriveHealthStatus, APPEAL_STATUS } = require('../utils/league_enforcement');

const SUBTITLE = 'League Appeals';

function staffCanManage(interaction) {
    return Boolean(interaction.member?.permissions?.has(PermissionsBitField.Flags.ManageRoles));
}
function ephemeralNotice(interaction, message, title) {
    return interaction.reply({ ...noticePayload(message, { title, subtitle: SUBTITLE }), ephemeral: true });
}
function editNotice(interaction, message, title) {
    return interaction.editReply(noticePayload(message, { title, subtitle: SUBTITLE }));
}

function buildAppealCardComponents(appeal, { leagueName, strikeReason } = {}) {
    const container = new ContainerBuilder();
    const lines = [
        `**League:** ${leagueName || `#${appeal.league_id}`}`,
        `**Strike:** #${appeal.strike_id}${strikeReason ? ` — ${strikeReason}` : ''}`,
        `**Submitted by:** <@${appeal.submitted_by}>`,
        `**Statement:** ${appeal.statement}`,
        `**Status:** ${appeal.status}`,
    ];
    if (appeal.status === APPEAL_STATUS.REJECTED && appeal.review_notes) {
        lines.push(`**Review notes:** ${appeal.review_notes}`);
    }
    const block = buildTextBlock({ title: `Strike Appeal #${appeal.id}`, subtitle: SUBTITLE, lines });
    if (block) container.addTextDisplayComponents(block);

    const components = [container];
    if (appeal.status === APPEAL_STATUS.PENDING) {
        components.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`appeal:accept:${appeal.id}`).setLabel('Accept (lift strike)').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`appeal:reject:${appeal.id}`).setLabel('Reject').setStyle(ButtonStyle.Danger),
        ));
    }
    return components;
}

async function postAppealCard(client, appeal, { leagueName, strikeReason } = {}) {
    const channel = await client.channels.fetch(LEAGUE_LOG_CHANNEL_ID);
    return channel.send({ flags: MessageFlags.IsComponentsV2, components: buildAppealCardComponents(appeal, { leagueName, strikeReason }) });
}

async function updateAppealCard(client, appeal, { leagueName, strikeReason } = {}) {
    if (!appeal.ops_message_id) {
        return;
    }
    try {
        const channel = await client.channels.fetch(LEAGUE_LOG_CHANNEL_ID);
        const message = await channel.messages.fetch(appeal.ops_message_id);
        await message.edit({ flags: MessageFlags.IsComponentsV2, components: buildAppealCardComponents(appeal, { leagueName, strikeReason }) });
    } catch (error) {
        logger.error(`[Appeals] Failed to update appeal card ${appeal.id}:`, error.message);
    }
}

async function dmUser(client, userId, { title, subtitle, lines }) {
    try {
        const user = await client.users.fetch(String(userId));
        const container = new ContainerBuilder();
        const block = buildTextBlock({ title, subtitle, lines });
        if (block) container.addTextDisplayComponents(block);
        await user.send({ flags: MessageFlags.IsComponentsV2, components: [container] });
    } catch (error) {
        logger.error(`[Appeals] Failed to DM ${userId}:`, error.message);
    }
}

// Recompute stored health from active strikes after a strike is lifted.
async function refreshHealth(leagueId) {
    const count = await countActiveStrikes(leagueId);
    await setLeagueHealthStatus(leagueId, deriveHealthStatus(count));
}

async function handleAppealsButton(interaction) {
    const [, action, idStr] = interaction.customId.split(':');
    const appealId = parseInt(idStr, 10);
    if (action === 'accept') {
        return handleAccept(interaction, appealId);
    }
    if (action === 'reject') {
        return showRejectModal(interaction, appealId);
    }
    logger.warn('[Appeals] Unknown button action:', action);
}

async function handleAccept(interaction, appealId) {
    if (!staffCanManage(interaction)) {
        return ephemeralNotice(interaction, 'You do not have permission to review appeals.', 'Permission Denied');
    }
    await interaction.deferReply({ ephemeral: true });

    // Accepting the appeal and lifting the strike are one atomic transaction so
    // an accepted appeal can never leave its strike active.
    const accepted = await acceptAppealAndLiftStrike(appealId, interaction.user.id);
    if (!accepted) {
        return editNotice(interaction, 'This appeal has already been reviewed.', 'Already Handled');
    }
    await refreshHealth(accepted.league_id);

    logger.info(`[Appeals] Appeal ${appealId} accepted by ${interaction.user.id} (strike ${accepted.strike_id} lifted)`);
    const league = await fetchLeagueById(accepted.league_id);
    const strike = await fetchStrikeById(accepted.strike_id);
    await updateAppealCard(interaction.client, accepted, { leagueName: league?.league_name, strikeReason: strike?.reason });
    await dmUser(interaction.client, accepted.submitted_by, {
        title: 'Appeal Accepted',
        subtitle: league?.league_name,
        lines: [`Your appeal for strike #${accepted.strike_id} was accepted and the strike has been lifted.`],
    });
    return editNotice(interaction, `Appeal #${appealId} accepted; strike #${accepted.strike_id} lifted.`, 'Appeal Accepted');
}

async function showRejectModal(interaction, appealId) {
    if (!staffCanManage(interaction)) {
        return ephemeralNotice(interaction, 'You do not have permission to review appeals.', 'Permission Denied');
    }
    const modal = new ModalBuilder().setCustomId(`appeal:rejectmodal:${appealId}`).setTitle('Reject Appeal');
    const notes = new TextInputBuilder()
        .setCustomId('notes').setLabel('Reason / notes for the requester')
        .setStyle(TextInputStyle.Paragraph).setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(notes));
    await interaction.showModal(modal);
}

async function handleAppealsModal(interaction) {
    const [, action, idStr] = interaction.customId.split(':');
    if (action !== 'rejectmodal') {
        logger.warn('[Appeals] Unknown modal action:', action);
        return;
    }
    const appealId = parseInt(idStr, 10);
    if (!staffCanManage(interaction)) {
        return ephemeralNotice(interaction, 'You do not have permission to review appeals.', 'Permission Denied');
    }
    await interaction.deferReply({ ephemeral: true });

    const notes = interaction.fields.getTextInputValue('notes');
    const rejected = await resolveAppeal(appealId, APPEAL_STATUS.REJECTED, interaction.user.id, notes);
    if (!rejected) {
        return editNotice(interaction, 'This appeal has already been reviewed.', 'Already Handled');
    }

    logger.info(`[Appeals] Appeal ${appealId} rejected by ${interaction.user.id}`);
    const league = await fetchLeagueById(rejected.league_id);
    const strike = await fetchStrikeById(rejected.strike_id);
    await updateAppealCard(interaction.client, rejected, { leagueName: league?.league_name, strikeReason: strike?.reason });
    await dmUser(interaction.client, rejected.submitted_by, {
        title: 'Appeal Rejected',
        subtitle: league?.league_name,
        lines: [`Your appeal for strike #${rejected.strike_id} was rejected.`, `**Notes:** ${notes}`],
    });
    return editNotice(interaction, `Appeal #${appealId} rejected and the requester was notified.`, 'Appeal Rejected');
}

module.exports = {
    postAppealCard,
    handleAppealsButton,
    handleAppealsModal,
};
