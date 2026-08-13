'use strict';

const { MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const logger = require('../utils/logger');
const { noticePayload } = require('../utils/ui');
const { fetchTransferRequestByMessageId, updateTransferRequestStatus } = require('../db');
const squadDb = require('../utils/squad_db');
const { ownerRolesAfterDisband } = require('../commands/squads/squad_disband');
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
    // back to (name, leader-owned) resolution.
    let squad = transfer.squad_id ? await squadDb.fetchSquadById(transfer.squad_id) : null;
    if (!squad) {
        squad = (await squadDb.fetchSquadsByName(squadName))
            .find(s => String(s.owner_id) === String(leaderId)) || null;
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

    // Atomic swap: owner guard + target-membership check + row swaps in one
    // transaction; null means a re-validation failed.
    const updated = await squadDb.transferSquadOwnership(squad.id, leaderId, targetId, targetUsername, leaderUsername);
    if (!updated) {
        await updateTransferRequestStatus(interaction.message.id, 'Failed');
        return interaction.editReply(
            noticePayload('You are no longer a member of this squad, or the squad changed hands already.', { title: 'Transfer Failed', subtitle: 'Squad Transfer' })
        );
    }

    // A Casual+Competitive pair shares its name; move the sibling row too so
    // the name never splits between two owners.
    const siblings = (await squadDb.fetchSquadsByName(squadName))
        .filter(s => s.id !== squad.id && String(s.owner_id) === String(leaderId));
    for (const sibling of siblings) {
        await squadDb.updateSquadOwner(sibling.id, targetId, targetUsername);
    }

    // Role management: new leader gains, old leader keeps only what remaining
    // squads justify.
    if (targetMember) {
        await targetMember.roles.add(SQUAD_LEADER_ROLE_ID).catch(e =>
            logger.error(`[Transfer] Failed to add leader role to ${targetId}:`, e.message)
        );
        if (squadType === 'Competitive') {
            await targetMember.roles.add(COMPETITIVE_SQUAD_OWNER_ROLE_ID).catch(e =>
                logger.error(`[Transfer] Failed to add comp owner role to ${targetId}:`, e.message)
            );
        }
    }
    if (leaderMember) {
        const remainingSquads = await squadDb.fetchSquadsByOwner(leaderId);
        const transferredTypes = [squad, ...siblings].map(s => s.squad_type);
        const rolesToRemove = ownerRolesAfterDisband({ remainingSquads, disbandedTypes: transferredTypes });
        for (const roleId of rolesToRemove) {
            await leaderMember.roles.remove(roleId).catch(e =>
                logger.error(`[Transfer] Failed to remove role ${roleId} from ${leaderId}:`, e.message)
            );
        }
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
