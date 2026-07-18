'use strict';

// Interaction glue for league reward requests (Phase 5). The bot only records
// intake and status; a human with backend access does the actual fulfillment.
// customId scheme: reward:approve:<id>, reward:deny:<id>, reward:fulfill:<id>
// (buttons), reward:denymodal:<id> (modal).

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
    resolveRewardRequest,
    markRewardFulfilled,
    fetchLeagueById,
} = require('../db');
const { REWARD_STATUS, FULFILLMENT } = require('../utils/league_rewards');

const SUBTITLE = 'League Rewards';

function staffCanManage(interaction) {
    return Boolean(interaction.member?.permissions?.has(PermissionsBitField.Flags.ManageRoles));
}
function ephemeralNotice(interaction, message, title) {
    return interaction.reply({ ...noticePayload(message, { title, subtitle: SUBTITLE }), ephemeral: true });
}
function editNotice(interaction, message, title) {
    return interaction.editReply(noticePayload(message, { title, subtitle: SUBTITLE }));
}

function buildRewardCardComponents(request, leagueName) {
    const container = new ContainerBuilder();
    const lines = [
        `**League:** ${leagueName || `#${request.league_id}`}`,
        `**Requested by:** <@${request.requested_by}>`,
        `**Reward:** ${request.reward_type}`,
        `**Details:** ${request.details || 'None'}`,
        `**Status:** ${request.status}`,
        `**Fulfillment:** ${request.external_fulfillment_status}`,
    ];
    if (request.status === REWARD_STATUS.DENIED && request.review_notes) {
        lines.push(`**Notes:** ${request.review_notes}`);
    }
    const block = buildTextBlock({ title: `Reward Request #${request.id}`, subtitle: SUBTITLE, lines });
    if (block) container.addTextDisplayComponents(block);

    const components = [container];
    if (request.status === REWARD_STATUS.PENDING) {
        components.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`reward:approve:${request.id}`).setLabel('Approve').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`reward:deny:${request.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger),
        ));
    } else if (request.status === REWARD_STATUS.APPROVED) {
        components.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`reward:fulfill:${request.id}`).setLabel('Mark Fulfilled').setStyle(ButtonStyle.Primary),
        ));
    }
    return components;
}

async function postRewardCard(client, request, leagueName) {
    const channel = await client.channels.fetch(LEAGUE_LOG_CHANNEL_ID);
    return channel.send({ flags: MessageFlags.IsComponentsV2, components: buildRewardCardComponents(request, leagueName) });
}

async function updateRewardCard(client, request, leagueName) {
    if (!request.ops_message_id) {
        return;
    }
    try {
        const channel = await client.channels.fetch(LEAGUE_LOG_CHANNEL_ID);
        const message = await channel.messages.fetch(request.ops_message_id);
        await message.edit({ flags: MessageFlags.IsComponentsV2, components: buildRewardCardComponents(request, leagueName) });
    } catch (error) {
        logger.error(`[Rewards] Failed to update reward card ${request.id}:`, error.message);
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
        logger.error(`[Rewards] Failed to DM ${userId}:`, error.message);
    }
}

async function handleRewardsButton(interaction) {
    const [, action, idStr] = interaction.customId.split(':');
    const id = parseInt(idStr, 10);
    if (action === 'approve') {
        return handleApprove(interaction, id);
    }
    if (action === 'deny') {
        return showDenyModal(interaction, id);
    }
    if (action === 'fulfill') {
        return handleFulfill(interaction, id);
    }
    logger.warn('[Rewards] Unknown button action:', action);
}

async function handleApprove(interaction, id) {
    if (!staffCanManage(interaction)) {
        return ephemeralNotice(interaction, 'You do not have permission to review reward requests.', 'Permission Denied');
    }
    await interaction.deferReply({ ephemeral: true });
    const approved = await resolveRewardRequest(id, REWARD_STATUS.APPROVED, interaction.user.id, null, FULFILLMENT.AWAITING);
    if (!approved) {
        return editNotice(interaction, 'This request has already been reviewed.', 'Already Handled');
    }
    logger.info(`[Rewards] Request ${id} approved by ${interaction.user.id}`);
    const league = await fetchLeagueById(approved.league_id);
    await updateRewardCard(interaction.client, approved, league?.league_name);
    await dmUser(interaction.client, approved.requested_by, {
        title: 'Reward Approved',
        subtitle: league?.league_name,
        lines: [`Your reward request #${id} (${approved.reward_type}) was approved and is awaiting fulfillment.`],
    });
    return editNotice(interaction, `Reward #${id} approved; now awaiting fulfillment.`, 'Reward Approved');
}

async function handleFulfill(interaction, id) {
    if (!staffCanManage(interaction)) {
        return ephemeralNotice(interaction, 'You do not have permission to fulfil reward requests.', 'Permission Denied');
    }
    await interaction.deferReply({ ephemeral: true });
    const fulfilled = await markRewardFulfilled(id, interaction.user.id);
    if (!fulfilled) {
        return editNotice(interaction, 'This request is not in an approved state.', 'Not Fulfillable');
    }
    logger.info(`[Rewards] Request ${id} fulfilled by ${interaction.user.id}`);
    const league = await fetchLeagueById(fulfilled.league_id);
    await updateRewardCard(interaction.client, fulfilled, league?.league_name);
    await dmUser(interaction.client, fulfilled.requested_by, {
        title: 'Reward Fulfilled',
        subtitle: league?.league_name,
        lines: [`Your reward request #${id} (${fulfilled.reward_type}) has been fulfilled.`],
    });
    return editNotice(interaction, `Reward #${id} marked fulfilled.`, 'Reward Fulfilled');
}

async function showDenyModal(interaction, id) {
    if (!staffCanManage(interaction)) {
        return ephemeralNotice(interaction, 'You do not have permission to review reward requests.', 'Permission Denied');
    }
    const modal = new ModalBuilder().setCustomId(`reward:denymodal:${id}`).setTitle('Deny Reward Request');
    const notes = new TextInputBuilder()
        .setCustomId('notes').setLabel('Reason for the requester')
        .setStyle(TextInputStyle.Paragraph).setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(notes));
    await interaction.showModal(modal);
}

async function handleRewardsModal(interaction) {
    const [, action, idStr] = interaction.customId.split(':');
    if (action !== 'denymodal') {
        logger.warn('[Rewards] Unknown modal action:', action);
        return;
    }
    const id = parseInt(idStr, 10);
    if (!staffCanManage(interaction)) {
        return ephemeralNotice(interaction, 'You do not have permission to review reward requests.', 'Permission Denied');
    }
    await interaction.deferReply({ ephemeral: true });
    const notes = interaction.fields.getTextInputValue('notes');
    const denied = await resolveRewardRequest(id, REWARD_STATUS.DENIED, interaction.user.id, notes, FULFILLMENT.NONE);
    if (!denied) {
        return editNotice(interaction, 'This request has already been reviewed.', 'Already Handled');
    }
    logger.info(`[Rewards] Request ${id} denied by ${interaction.user.id}`);
    const league = await fetchLeagueById(denied.league_id);
    await updateRewardCard(interaction.client, denied, league?.league_name);
    await dmUser(interaction.client, denied.requested_by, {
        title: 'Reward Denied',
        subtitle: league?.league_name,
        lines: [`Your reward request #${id} was denied.`, `**Notes:** ${notes}`],
    });
    return editNotice(interaction, `Reward #${id} denied and the requester was notified.`, 'Reward Denied');
}

module.exports = {
    postRewardCard,
    handleRewardsButton,
    handleRewardsModal,
};
