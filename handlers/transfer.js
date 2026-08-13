'use strict';

const { MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const logger = require('../utils/logger');
const { noticePayload } = require('../utils/ui');
const { fetchTransferRequestByMessageId, updateTransferRequestStatus } = require('../db');
const squadDb = require('../utils/squad_db');
const { ownerRolesAfterDisband } = require('../commands/squads/squad_disband');
const { finalizeApplicationCard } = require('./squad_discovery');

async function notifyApplicant(client, userId, squadName) {
    try {
        const user = await client.users.fetch(String(userId));
        const container = new ContainerBuilder();
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent('## Application Closed'),
            new TextDisplayBuilder().setContent(`**${squadName}** changed owners, so your pending application was closed. You can apply again anytime.`)
        );
        await user.send({ flags: MessageFlags.IsComponentsV2, components: [container] });
    } catch (error) {
        logger.error(`[Transfer] Failed to notify applicant ${userId}:`, error.message);
    }
}
const {
    GYM_CLASS_GUILD_ID,
    SQUAD_LEADER_ROLE_ID,
    COMPETITIVE_SQUAD_OWNER_ROLE_ID,
} = require('../config/constants');

const handleTransferButton = async (interaction, action) => {
    try {
        await interaction.deferReply({ ephemeral: true });

        const transfer = await fetchTransferRequestByMessageId(interaction.message.id);
        if (!transfer) {
            return interaction.editReply(
                noticePayload('This transfer request is no longer available.', { title: 'Transfer Expired', subtitle: 'Squad Transfer' })
            );
        }

        if (transfer.status !== 'Pending') {
            return interaction.editReply(
                noticePayload(`This transfer has already been processed (${transfer.status}).`, { title: 'Transfer Processed', subtitle: 'Squad Transfer' })
            );
        }

        if (transfer.expires_at && new Date(transfer.expires_at) <= new Date()) {
            await updateTransferRequestStatus(interaction.message.id, 'Expired');
            return interaction.editReply(
                noticePayload('This transfer request has expired.', { title: 'Transfer Expired', subtitle: 'Squad Transfer' })
            );
        }

        if (interaction.user.id !== transfer.target_id) {
            return interaction.editReply(
                noticePayload('Only the designated recipient can respond to this transfer.', { title: 'Not Authorized', subtitle: 'Squad Transfer' })
            );
        }

        if (action === 'accept') {
            await handleAccept(interaction, transfer);
        } else {
            await handleDecline(interaction, transfer);
        }
    } catch (error) {
        logger.error('[Transfer Handler] Error:', error);
        await interaction.editReply(
            noticePayload('An error occurred while processing the transfer.', { title: 'Transfer Error', subtitle: 'Squad Transfer' })
        ).catch(() => {});
    }
};

const handleAccept = async (interaction, transfer) => {
    const { leader_id: leaderId, target_id: targetId, squad_name: squadName, squad_type: squadType } = transfer;

    // Resolve the squad: new transfers carry squad_id; older pending rows fall
    // back to (name, leader-owned) resolution, preferring the Competitive row
    // of a pair since that is where memberships live.
    let squad = transfer.squad_id ? await squadDb.fetchSquadById(transfer.squad_id) : null;
    if (!squad) {
        const candidates = (await squadDb.fetchSquadsByName(squadName))
            .filter(s => String(s.owner_id) === String(leaderId));
        squad = candidates.find(s => s.squad_type === 'Competitive') || candidates[0] || null;
    }
    if (!squad || String(squad.owner_id) !== String(leaderId)) {
        await updateTransferRequestStatus(interaction.message.id, 'Failed');
        return interaction.editReply(
            noticePayload('The original leader no longer owns this squad.', { title: 'Transfer Failed', subtitle: 'Squad Transfer' })
        );
    }

    const guild = await interaction.client.guilds.fetch(GYM_CLASS_GUILD_ID);
    const targetMember = await guild.members.fetch(targetId).catch(() => null);
    const leaderMember = await guild.members.fetch(leaderId).catch(() => null);
    const targetUsername = targetMember ? targetMember.user.username : targetId;
    const leaderUsername = leaderMember ? leaderMember.user.username : leaderId;

    // Types that will change hands (the whole same-name group moves inside
    // the transfer transaction), captured before the swap for role cleanup.
    // Keyed on the resolved row's CURRENT name: the request's stored name
    // goes stale if the squad was renamed while the transfer sat pending.
    const transferredTypes = (await squadDb.fetchSquadsByName(squad.name))
        .filter(s => String(s.owner_id) === String(leaderId))
        .map(s => s.squad_type);

    // Atomic swap: owner guard + target-membership check + row swaps +
    // same-name siblings + A/B link severing, all in one transaction; null
    // means a re-validation failed.
    const updated = await squadDb.transferSquadOwnership(squad.id, leaderId, targetId, targetUsername, leaderUsername);
    if (!updated) {
        await updateTransferRequestStatus(interaction.message.id, 'Failed');
        return interaction.editReply(
            noticePayload('You are no longer a member of this squad, or the squad changed hands already.', { title: 'Transfer Failed', subtitle: 'Squad Transfer' })
        );
    }

    // Role management: new leader gains, old leader keeps only what remaining
    // squads justify.
    if (targetMember) {
        await targetMember.roles.add(SQUAD_LEADER_ROLE_ID).catch(e =>
            logger.error(`[Transfer] Failed to add leader role to ${targetId}:`, e.message)
        );
        // Current types, not the request's stored squad_type: a legacy row may
        // be labelled Casual while the pair also moves a Competitive squad.
        if (transferredTypes.includes('Competitive')) {
            await targetMember.roles.add(COMPETITIVE_SQUAD_OWNER_ROLE_ID).catch(e =>
                logger.error(`[Transfer] Failed to add comp owner role to ${targetId}:`, e.message)
            );
        }
    }
    if (leaderMember) {
        const remainingSquads = await squadDb.fetchSquadsByOwner(leaderId);
        const rolesToRemove = ownerRolesAfterDisband({ remainingSquads, disbandedTypes: transferredTypes });
        for (const roleId of rolesToRemove) {
            await leaderMember.roles.remove(roleId).catch(e =>
                logger.error(`[Transfer] Failed to remove role ${roleId} from ${leaderId}:`, e.message)
            );
        }
    }

    // Pending applications were addressed to the old owner (their DM holds
    // the card); the new owner never sees them, so close them out.
    for (const pending of await squadDb.fetchPendingApplicationsBySquad(squad.id)) {
        const expired = await squadDb.claimApplication(pending.id, 'Expired', 'transfer');
        if (!expired) continue;
        await finalizeApplicationCard(interaction.client, expired, { ...squad, owner_id: leaderId }, '**Status:** Closed (squad changed owners)');
        await notifyApplicant(interaction.client, expired.user_id, squadName);
    }

    await updateTransferRequestStatus(interaction.message.id, 'Accepted');

    // Update the DM message
    const acceptedContainer = new ContainerBuilder()
        .setAccentColor(0x2ECC71)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent('## Transfer Complete'),
            new TextDisplayBuilder().setContent(`You are now the owner of **${squadName}** (${squadType}).`)
        );
    await interaction.message.edit({
        flags: MessageFlags.IsComponentsV2,
        components: [acceptedContainer],
    }).catch(() => {});

    await interaction.editReply(
        noticePayload(`You are now the owner of **${squadName}**.`, { title: 'Transfer Complete', subtitle: 'Squad Transfer' })
    );

    // Notify old leader
    const leader = await interaction.client.users.fetch(leaderId).catch(() => null);
    if (leader) {
        const notifyContainer = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent('## Transfer Accepted'),
                new TextDisplayBuilder().setContent(
                    `**${interaction.user.username}** accepted ownership of **${squadName}**. You are now a regular member.`
                )
            );
        await leader.send({
            flags: MessageFlags.IsComponentsV2,
            components: [notifyContainer],
        }).catch(e => logger.error(`[Transfer] Failed to DM old leader ${leaderId}:`, e.message));
    }
};

const handleDecline = async (interaction, transfer) => {
    const { leader_id: leaderId, squad_name: squadName } = transfer;

    await updateTransferRequestStatus(interaction.message.id, 'Declined');

    // Update the DM message
    const declinedContainer = new ContainerBuilder()
        .setAccentColor(0x95A5A6)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent('## Transfer Declined'),
            new TextDisplayBuilder().setContent(`You declined ownership of **${squadName}**.`)
        );
    await interaction.message.edit({
        flags: MessageFlags.IsComponentsV2,
        components: [declinedContainer],
    }).catch(() => {});

    await interaction.editReply(
        noticePayload('You have declined the transfer.', { title: 'Transfer Declined', subtitle: 'Squad Transfer' })
    );

    // Notify old leader
    const leader = await interaction.client.users.fetch(leaderId).catch(() => null);
    if (leader) {
        const notifyContainer = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent('## Transfer Declined'),
                new TextDisplayBuilder().setContent(
                    `**${interaction.user.username}** declined ownership of **${squadName}**.`
                )
            );
        await leader.send({
            flags: MessageFlags.IsComponentsV2,
            components: [notifyContainer],
        }).catch(e => logger.error(`[Transfer] Failed to DM leader ${leaderId}:`, e.message));
    }
};

module.exports = {
    handleTransferButton,
};
