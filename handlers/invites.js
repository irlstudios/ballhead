'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const logger = require('../utils/logger');
const { buildTextBlock, buildNoticeContainer, noticePayload } = require('../utils/ui');
const { fetchInviteById, updateInviteStatus, deleteInvite } = require('../db');
const { getSheetsClient } = require('../utils/sheets_cache');
const { mascotSquads } = require('../config/squads');
const { withSquadLock } = require('../utils/squad_lock');
const { isSameSquad, normalizeId, normalizeSquadName } = require('../utils/squad_queries');
const {
    GYM_CLASS_GUILD_ID,
    BOT_BUGS_CHANNEL_ID,
    LOGGING_CHANNEL_ID,
    SPREADSHEET_SQUADS,
    MAX_SQUAD_MEMBERS,
    SL_SQUAD_NAME,
    SL_EVENT_SQUAD,
    AD_PREFERENCE,
} = require('../config/constants');

const handleInviteButton = async (interaction, action) => {
    try {
        await interaction.deferReply({ ephemeral: true });

        let inviteData;
        try {
            inviteData = await fetchInviteById(interaction.message.id);
            if (!inviteData) throw new Error('404');
        } catch (apiError) {
            if (apiError.message === '404') {
                await interaction.editReply(
                    noticePayload('This invite seems to have expired or is invalid.', { title: 'Invite Expired', subtitle: 'Squad Invite' })
                );
            } else {
                logger.error('Error fetching invite data:', apiError.message);
                await interaction.editReply(
                    noticePayload('Could not verify the invite status.', { title: 'Invite Error', subtitle: 'Squad Invite' })
                );
            }
            return;
        }

        if (!inviteData) {
            await interaction.editReply(noticePayload('The invite is no longer available.', { title: 'Invite Unavailable', subtitle: 'Squad Invite' }));
            return;
        }

        const { squad_name: squadName, tracking_message_id: trackingMessageId, command_user_id: commandUserID, invited_member_id: invitedMemberId, squad_type: squadType, invite_status: currentInviteStatus } = inviteData;

        if (currentInviteStatus === 'Accepted' || currentInviteStatus === 'Rejected' || currentInviteStatus === 'Squad Full') {
            await interaction.editReply(noticePayload(`This invite has already been processed (${currentInviteStatus}).`, { title: 'Invite Processed', subtitle: 'Squad Invite' }));
            return;
        }
        if (inviteData.expires_at && new Date(inviteData.expires_at) <= new Date()) {
            await interaction.editReply(noticePayload('This invite has expired.', { title: 'Invite Expired', subtitle: 'Squad Invite' }));
            try { await deleteInvite(interaction.message.id); } catch (e) { logger.error('Failed to delete expired invite:', e); }
            return;
        }
        if (interaction.user.id !== normalizeId(invitedMemberId)) {
            await interaction.editReply(noticePayload('You cannot interact with an invite meant for someone else.', { title: 'Invite Restricted', subtitle: 'Squad Invite' }));
            return;
        }

        const fetchedGuild = await interaction.client.guilds.fetch(GYM_CLASS_GUILD_ID).catch(() => null);
        const guild = interaction.guild && interaction.guild.id === GYM_CLASS_GUILD_ID
            ? interaction.guild
            : fetchedGuild;

        if (!guild) {
            logger.error('Could not fetch required Guilds.');
            await interaction.editReply(noticePayload('Could not find the necessary server.', { title: 'Server Not Found', subtitle: 'Squad Invite' }));
            return;
        }

        let trackingChannel;
        if (guild) {
            trackingChannel = guild.channels.cache.get(LOGGING_CHANNEL_ID) || await guild.channels.fetch(LOGGING_CHANNEL_ID).catch(err => { logger.error(`Failed to fetch tracking channel: ${err.message}`); return null; });
        }
        let trackingMessage;
        if (trackingChannel && trackingMessageId) {
            trackingMessage = await trackingChannel.messages.fetch(trackingMessageId).catch(err => { logger.warn(`Failed to fetch tracking message ${trackingMessageId}: ${err.message}`); return null; });
        }

        const commandUser = await interaction.client.users.fetch(commandUserID).catch(err => {
            logger.warn(`Failed to fetch command user ${commandUserID}: ${err.message}`);
            return null;
        });
        const inviteMessage = interaction.message;

        if (action === 'accept') {
            await withSquadLock(`invitee:${invitedMemberId}`, () =>
                withSquadLock(squadName, () =>
                    handleAcceptInvite(interaction, {
                        guild,
                        squadName,
                        squadType,
                        trackingMessage,
                        commandUserID,
                        invitedMemberId,
                        commandUser,
                        inviteMessage,
                    })
                )
            );
        } else if (action === 'reject') {
            await withSquadLock(`invitee:${invitedMemberId}`, () =>
                withSquadLock(squadName, () =>
                    handleRejectInvite(interaction, {
                        squadName,
                        trackingMessage,
                        commandUserID,
                        invitedMemberId,
                        commandUser,
                        inviteMessage,
                    })
                )
            );
        } else {
            await interaction.editReply({ ...noticePayload('Unknown action specified.', { title: 'Unknown Action', subtitle: 'Squad Invite' }), ephemeral: true });
        }
    } catch (error) {
        logger.error('Error handling invite button interaction:', error);
        await interaction.editReply({
            ...noticePayload('An error occurred while processing the invite interaction.', { title: 'Invite Error', subtitle: 'Squad Invite' }),
            ephemeral: true,
        }).catch(e => logger.error('editReply failed:', e));

        try {
            const errorGuild = await interaction.client.guilds.fetch(GYM_CLASS_GUILD_ID).catch(() => null);
            if (!errorGuild) return;
            const errorChannel = await errorGuild.channels.fetch(BOT_BUGS_CHANNEL_ID).catch(() => null);
            if (!errorChannel) return;
            const errorContainer = new ContainerBuilder();
            const block = buildTextBlock({
                title: 'Invite Interaction Error',
                subtitle: 'Squad invite action failed',
                lines: [
                    `**User:** ${interaction.user.tag} (${interaction.user.id})`,
                    `**Action:** ${action}`,
                    `**Message ID:** ${interaction.message.id}`,
                    `**Error:** ${error.message}`,
                ],
            });
            if (block) errorContainer.addTextDisplayComponents(block);
            await errorChannel.send({ flags: MessageFlags.IsComponentsV2, components: [errorContainer] });
        } catch (logError) {
            logger.error('Failed to log button interaction error:', logError);
        }
    }
};

const handleAcceptInvite = async (interaction, ctx) => {
    const { guild, squadName, squadType, trackingMessage, commandUserID, invitedMemberId, commandUser, inviteMessage } = ctx;

    const freshInvite = await fetchInviteById(interaction.message.id);
    if (!freshInvite || freshInvite.invite_status !== 'Pending') {
        const status = freshInvite ? freshInvite.invite_status : 'unknown';
        await interaction.editReply(noticePayload(`This invite has already been processed (${status}).`, { title: 'Invite Processed', subtitle: 'Squad Invite' }));
        return;
    }

    const member = await guild.members.fetch(invitedMemberId).catch(() => null);
    if (!member) {
        await interaction.editReply(noticePayload('You could not be found in the server.', { title: 'Member Not Found', subtitle: 'Squad Invite' }));
        return;
    }

    const sheets = await getSheetsClient();

    const [squadMembersResponse, allDataResponse, squadLeadersResponse] = await Promise.all([
        sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_SQUADS, range: 'Squad Members!A:E' }),
        sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_SQUADS, range: 'All Data!A:H' }),
        sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_SQUADS, range: 'Squad Leaders!A:G' }),
    ]).catch(error => {
        throw new Error(`Failed to retrieve sheet data for processing invite: ${error.message}`);
    });

    const squadMembersData = (squadMembersResponse.data.values || []).slice(1);
    const allData = allDataResponse.data.values || [];
    const allDataHeaderless = allData.slice(1);
    const squadLeadersData = (squadLeadersResponse.data.values || []).slice(1);

    const inviterStillOwnsSquad = squadLeadersData.some(
        row => normalizeId(row?.[1]) === normalizeId(commandUserID) && isSameSquad(row?.[SL_SQUAD_NAME], squadName)
    );
    const inviterStillInGuild = await guild.members.fetch(commandUserID).catch(() => null);
    if (!inviterStillOwnsSquad || !inviterStillInGuild) {
        await interaction.editReply(noticePayload(
            'This invite is no longer valid because the squad owner or squad is no longer active.',
            { title: 'Invite Invalid', subtitle: 'Squad Invite' }
        ));
        await deleteInvite(interaction.message.id).catch(error =>
            logger.error('[Invite Accept] Failed to delete invalid invite:', error.message)
        );
        const invalidContainer = buildNoticeContainer({
            title: 'Invitation Unavailable',
            subtitle: squadName,
            lines: ['The squad owner or squad is no longer active.'],
        });
        await inviteMessage.edit({
            flags: MessageFlags.IsComponentsV2,
            components: [invalidContainer],
        }).catch(() => {});
        return;
    }

    const inviteeIsLeader = squadLeadersData.some(
        row => normalizeId(row?.[1]) === normalizeId(invitedMemberId)
    );
    if (inviteeIsLeader) {
        await interaction.editReply(noticePayload(
            'You are already a squad leader and cannot join another squad as a member.',
            { title: 'Already a Leader', subtitle: 'Squad Invite' }
        ));
        return;
    }

    const existingMembership = squadMembersData.find(
        row => normalizeId(row?.[1]) === normalizeId(invitedMemberId)
    );
    if (existingMembership) {
        if (isSameSquad(existingMembership[2], squadName)) {
            await updateInviteStatus(interaction.message.id, 'Accepted').catch(error =>
                logger.error('[Invite Accept] Failed to finalize idempotent invite:', error.message)
            );
            await interaction.editReply(noticePayload(
                `You are already a member of **${squadName}**. This invite has been closed.`,
                { title: 'Already Joined', subtitle: 'Squad Invite' }
            ));
            await deleteInvite(interaction.message.id).catch(() => {});
        } else {
            await interaction.editReply(noticePayload(
                `You are already in **${existingMembership[2] || 'another squad'}**.`,
                { title: 'Already in a Squad', subtitle: 'Squad Invite' }
            ));
        }
        return;
    }

    const memberIdsInSquad = new Set(squadMembersData
        .filter(row => isSameSquad(row?.[2], squadName))
        .map(row => normalizeId(row?.[1]))
        .filter(Boolean));
    const currentMemberCount = memberIdsInSquad.size + 1;

    if (currentMemberCount >= MAX_SQUAD_MEMBERS) {
        await interaction.editReply({
            ...noticePayload(`Cannot accept: Squad **${squadName}** is full (${currentMemberCount}/${MAX_SQUAD_MEMBERS}).`, { title: 'Squad Full', subtitle: 'Squad Invite' }),
            ephemeral: true,
        });
        if (trackingMessage) {
            const trackingContainer = buildNoticeContainer({ title: 'Invite Failed', subtitle: squadName, lines: [`Invite from <@${commandUserID}> to <@${invitedMemberId}> failed: Squad Full.`] });
            await trackingMessage.edit({ flags: MessageFlags.IsComponentsV2, components: [trackingContainer] }).catch(e => logger.error('tracking edit fail:', e));
        }
        try { await updateInviteStatus(interaction.message.id, 'Squad Full'); } catch (apiError) { logger.error('API Error updating invite status:', apiError.message); }
        const components = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`invite_accept_${interaction.message.id}`).setLabel('Accept Invite').setStyle(ButtonStyle.Success).setDisabled(true),
            new ButtonBuilder().setCustomId(`invite_reject_${interaction.message.id}`).setLabel('Reject Invite').setStyle(ButtonStyle.Danger).setDisabled(true)
        );
        const squadFullContainer = new ContainerBuilder();
        const block = buildTextBlock({ title: 'Squad Full', subtitle: squadName, lines: [`Squad **${squadName}** is full (${currentMemberCount}/${MAX_SQUAD_MEMBERS}).`] });
        if (block) squadFullContainer.addTextDisplayComponents(block);
        await inviteMessage.edit({ flags: MessageFlags.IsComponentsV2, components: [squadFullContainer, components] }).catch(e => logger.error('invite edit fail:', e));
        return;
    }

    const defaultEventSquad = 'N/A';
    const defaultOpenSquad = 'FALSE';
    const defaultIsLeader = 'No';
    let eventSquadNameToAssign = null;

    const leaderRow = squadLeadersData.find(
        row => row && row.length > SL_SQUAD_NAME
            && normalizeId(row[1]) === normalizeId(commandUserID)
            && isSameSquad(row[SL_SQUAD_NAME], squadName)
    );
    if (leaderRow) {
        const leaderEventSquad = leaderRow[SL_EVENT_SQUAD];
        if (leaderEventSquad && leaderEventSquad !== 'N/A') {
            eventSquadNameToAssign = leaderEventSquad;
        }
    }

    const inviteeAllDataRows = allDataHeaderless
        .map((row, index) => ({ row, index }))
        .filter(item => normalizeId(item.row?.[1]) === normalizeId(invitedMemberId));
    const availableAllDataRow = inviteeAllDataRows.find(item => {
        const currentSquad = normalizeSquadName(item.row?.[2]);
        return !currentSquad || currentSquad === 'N/A';
    });
    if (!availableAllDataRow && inviteeAllDataRows.length > 0) {
        await interaction.editReply(noticePayload(
            'Your squad profile is already assigned to another squad. Please contact an admin to correct it.',
            { title: 'Squad Data Conflict', subtitle: 'Squad Invite' }
        ));
        return;
    }

    const preferenceRow = availableAllDataRow?.row || inviteeAllDataRows[0]?.row;
    const existingPreference = preferenceRow
        && (preferenceRow[AD_PREFERENCE] === 'TRUE' || preferenceRow[AD_PREFERENCE] === 'FALSE')
        ? preferenceRow[AD_PREFERENCE]
        : 'TRUE';
    const allDataRow = [
        member.user.username,
        member.id,
        squadName,
        squadType,
        eventSquadNameToAssign || defaultEventSquad,
        defaultOpenSquad,
        defaultIsLeader,
        existingPreference,
    ];
    const currentDate = new Date();
    const dateString = `${(currentDate.getMonth() + 1).toString().padStart(2, '0')}/${currentDate.getDate().toString().padStart(2, '0')}/${currentDate.getFullYear().toString().slice(-2)}`;
    const newSquadMemberRow = [member.user.username, member.id, squadName, eventSquadNameToAssign || defaultEventSquad, dateString];
    const memberAppendResponse = await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_SQUADS,
        range: 'Squad Members!A1',
        valueInputOption: 'RAW',
        resource: { values: [newSquadMemberRow] },
    }).catch(error => {
        throw new Error(`Failed to append to Squad Members sheet: ${error.message}`);
    });
    const appendedMemberRange = memberAppendResponse.data.updates?.updatedRange;

    try {
        if (availableAllDataRow) {
            const sheetRowIndex = availableAllDataRow.index + 2;
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_SQUADS,
                range: `All Data!A${sheetRowIndex}:H${sheetRowIndex}`,
                valueInputOption: 'RAW',
                resource: { values: [allDataRow] },
            });
        } else {
            await sheets.spreadsheets.values.append({
                spreadsheetId: SPREADSHEET_SQUADS,
                range: 'All Data!A1',
                valueInputOption: 'RAW',
                resource: { values: [allDataRow] },
            });
        }
    } catch (error) {
        if (appendedMemberRange) {
            await sheets.spreadsheets.values.clear({
                spreadsheetId: SPREADSHEET_SQUADS,
                range: appendedMemberRange,
            }).catch(rollbackError =>
                logger.error(`[Invite Accept] Failed to roll back ${appendedMemberRange}:`, rollbackError.message)
            );
        }
        throw new Error(`Failed to update All Data sheet: ${error.message}`);
    }

    await updateInviteStatus(interaction.message.id, 'Accepted').catch(error =>
        logger.error('[Invite Accept] Membership saved but invite status update failed:', error.message)
    );
    await interaction.editReply(noticePayload(
        `You have accepted the invite to join **${squadName}** (${squadType})!`,
        { title: 'Invite Accepted', subtitle: 'Squad Invite' }
    ));
    if (trackingMessage) {
        const trackingContainer = buildNoticeContainer({ title: 'Invite Accepted', subtitle: squadName, lines: [`<@${member.id}> accepted invite from <@${commandUserID}> to join **${squadName}** (${squadType}).`] });
        await trackingMessage.edit({ flags: MessageFlags.IsComponentsV2, components: [trackingContainer] }).catch(e => logger.error('tracking edit fail:', e));
    }

    try {
        await member.setNickname(`[${squadName}] ${member.user.username}`);
    } catch (error) {
        if (error.code === 50013) {
            logger.info(`Missing permissions to set nickname for ${member.user.tag}.`);
        } else {
            logger.error(`Could not change nickname for ${member.user.tag}:`, error.message);
        }
    }

    let assignedMascotRoleName = null;
    if (eventSquadNameToAssign) {
        const mascotInfo = mascotSquads.find(m => m.name === eventSquadNameToAssign);
        if (mascotInfo) {
            try {
                const roleToAdd = await guild.roles.fetch(mascotInfo.roleId);
                if (roleToAdd) {
                    await member.roles.add(roleToAdd);
                    assignedMascotRoleName = roleToAdd.name;
                } else {
                    logger.warn(`Mascot role ID ${mascotInfo.roleId} (${mascotInfo.name}) not found.`);
                    await interaction.followUp({ ...noticePayload(`Warning: Joined squad, but couldn't find mascot role (${mascotInfo.name}).`, { title: 'Mascot Role Missing', subtitle: 'Squad Invite' }), ephemeral: true }).catch(() => {});
                }
            } catch (roleError) {
                logger.error(`Failed to add mascot role ${mascotInfo.name}: ${roleError.message}`);
                await interaction.followUp({ ...noticePayload(`Warning: Joined squad, but couldn't assign mascot role (${mascotInfo.name}).`, { title: 'Mascot Role Failed', subtitle: 'Squad Invite' }), ephemeral: true }).catch(() => {});
            }
        }
    }

    const acceptanceContainer = new ContainerBuilder()
        .setAccentColor(0x2ECC71)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`## Welcome to ${squadName}!`),
            new TextDisplayBuilder().setContent('You\'ve joined the squad. Good luck!')
        );
    await inviteMessage.edit({ flags: MessageFlags.IsComponentsV2, components: [acceptanceContainer] }).catch(e => logger.error('invite edit fail:', e));

    const dmContainer = new ContainerBuilder()
        .setAccentColor(0x2ECC71)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`## ${member.user.username} Joined!`),
            new TextDisplayBuilder().setContent(`They accepted your invite to **${squadName}**.`)
        );
    if (assignedMascotRoleName) {
        dmContainer.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`-# Assigned role: ${assignedMascotRoleName}`)
        );
    }
    if (commandUser) {
        await commandUser.send({ flags: MessageFlags.IsComponentsV2, components: [dmContainer] }).catch(err => { logger.info(`Failed to DM command user ${commandUserID}: ${err.message}`); });
    }

    try { await deleteInvite(interaction.message.id); } catch (apiError) { logger.error('API Error deleting invite:', apiError.message); }
};

const handleRejectInvite = async (interaction, ctx) => {
    const { squadName, trackingMessage, commandUserID, invitedMemberId, commandUser, inviteMessage } = ctx;

    const freshInvite = await fetchInviteById(interaction.message.id);
    if (!freshInvite || freshInvite.invite_status !== 'Pending') {
        const status = freshInvite ? freshInvite.invite_status : 'unknown';
        await interaction.editReply(noticePayload(
            `This invite has already been processed (${status}).`,
            { title: 'Invite Processed', subtitle: 'Squad Invite' }
        ));
        return;
    }

    await updateInviteStatus(interaction.message.id, 'Rejected');
    await interaction.editReply({ ...noticePayload('You have rejected the invite.', { title: 'Invite Rejected', subtitle: 'Squad Invite' }), ephemeral: true });

    if (trackingMessage) {
        const trackingContainer = buildNoticeContainer({ title: 'Invite Rejected', subtitle: squadName, lines: [`<@${invitedMemberId}> rejected invite from <@${commandUserID}> for **${squadName}**.`] });
        await trackingMessage.edit({ flags: MessageFlags.IsComponentsV2, components: [trackingContainer] }).catch(e => logger.error('tracking edit fail:', e));
    }
    const rejectionContainer = new ContainerBuilder()
        .setAccentColor(0x95A5A6)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent('## Invite Declined'),
            new TextDisplayBuilder().setContent(`You declined the invite to **${squadName}**.`)
        );
    await inviteMessage.edit({ flags: MessageFlags.IsComponentsV2, components: [rejectionContainer] }).catch(e => logger.error('invite edit fail:', e));

    const dmRejectionContainer = new ContainerBuilder()
        .setAccentColor(0x95A5A6)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent('## Invite Declined'),
            new TextDisplayBuilder().setContent(`**${interaction.user.username}** declined your invite to **${squadName}**.`)
        );
    if (commandUser) {
        await commandUser.send({ flags: MessageFlags.IsComponentsV2, components: [dmRejectionContainer] }).catch(err => { logger.info(`Failed to DM command user about rejection: ${err.message}`); });
    }

    try { await deleteInvite(interaction.message.id); } catch (apiError) { logger.error('API Error deleting rejected invite:', apiError.message); }
};

module.exports = {
    handleInviteButton,
};
