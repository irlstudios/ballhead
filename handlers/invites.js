'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const logger = require('../utils/logger');
const { buildTextBlock, buildNoticeContainer, noticePayload } = require('../utils/ui');
const { fetchInviteById, updateInviteStatus, deleteInvite } = require('../db');
const { getSheetsClient } = require('../utils/sheets_cache');
const { mascotSquads } = require('../config/squads');
const { assignLevelRoleOnJoin } = require('../utils/squad_level_sync');
const {
    BALLHEAD_GUILD_ID,
    GYM_CLASS_GUILD_ID,
    BOT_BUGS_CHANNEL_ID,
    LOGGING_CHANNEL_ID,
    SPREADSHEET_SQUADS,
    MAX_SQUAD_MEMBERS,
    SL_SQUAD_NAME,
    SL_EVENT_SQUAD,
    AD_ID,
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
        if (interaction.user.id !== invitedMemberId) {
            await interaction.editReply(noticePayload('You cannot interact with an invite meant for someone else.', { title: 'Invite Restricted', subtitle: 'Squad Invite' }));
            return;
        }

        const gymClassGuild = await interaction.client.guilds.fetch(GYM_CLASS_GUILD_ID).catch(() => null);
        const ballheadGuild = await interaction.client.guilds.fetch(BALLHEAD_GUILD_ID).catch(() => null);
        const guild = interaction.guild && (interaction.guild.id === GYM_CLASS_GUILD_ID || interaction.guild.id === BALLHEAD_GUILD_ID)
            ? interaction.guild
            : (gymClassGuild || ballheadGuild);

        if (!guild) {
            logger.error('Could not fetch required Guilds.');
            await interaction.editReply(noticePayload('Could not find the necessary server.', { title: 'Server Not Found', subtitle: 'Squad Invite' }));
            return;
        }

        let trackingChannel;
        if (ballheadGuild) {
            trackingChannel = ballheadGuild.channels.cache.get(LOGGING_CHANNEL_ID) || await ballheadGuild.channels.fetch(LOGGING_CHANNEL_ID).catch(err => { logger.error(`Failed to fetch tracking channel: ${err.message}`); return null; });
        }
        let trackingMessage;
        if (trackingChannel && trackingMessageId) {
            trackingMessage = await trackingChannel.messages.fetch(trackingMessageId).catch(err => { logger.warn(`Failed to fetch tracking message ${trackingMessageId}: ${err.message}`); return null; });
        }

        const commandUser = await interaction.client.users.fetch(commandUserID).catch(err => { logger.error(`Failed to fetch command user ${commandUserID}: ${err.message}`); return null; });
        if (!commandUser) {
            await interaction.editReply(noticePayload('Could not find the user who sent the invite.', { title: 'Invite Error', subtitle: 'Squad Invite' }));
            return;
        }

        const inviteMessageChannel = interaction.channel || await interaction.client.channels.fetch(interaction.channelId).catch(err => { logger.error(`Failed to fetch invite message channel: ${err.message}`); return null; });
        if (!inviteMessageChannel) {
            await interaction.editReply(noticePayload('Failed to find the channel where the invite was sent.', { title: 'Channel Missing', subtitle: 'Squad Invite' }));
            return;
        }

        const inviteMessage = await inviteMessageChannel.messages.fetch(interaction.message.id).catch(err => { logger.error(`Failed to fetch invite message: ${err.message}`); return null; });
        if (!inviteMessage) {
            await interaction.editReply(noticePayload('Failed to find the original invite message.', { title: 'Invite Missing', subtitle: 'Squad Invite' }));
            return;
        }

        if (action === 'accept') {
            const { withSquadLock } = require('../utils/squad_lock');
            await withSquadLock(squadName, () => handleAcceptInvite(interaction, { guild, squadName, squadType, trackingMessage, trackingMessageId, commandUserID, invitedMemberId, commandUser, inviteMessage }));
        } else if (action === 'reject') {
            await handleRejectInvite(interaction, { squadName, trackingMessage, commandUserID, invitedMemberId, commandUser, inviteMessage });
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
            const errorGuild = await interaction.client.guilds.fetch(BALLHEAD_GUILD_ID).catch(() => null);
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
    ]).catch(() => { throw new Error('Failed to retrieve sheet data for processing invite.'); });

    const squadMembersData = (squadMembersResponse.data.values || []).slice(1);
    const allData = allDataResponse.data.values || [];
    const allDataHeaderless = allData.slice(1);
    const squadLeadersData = (squadLeadersResponse.data.values || []).slice(1);

    const membersInSquad = squadMembersData.filter(row => row && row.length > 2 && row[2]?.trim() === squadName);
    const currentMemberCount = membersInSquad.length + 1;

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

    await interaction.editReply(noticePayload(`You have accepted the invite to join **${squadName}** (${squadType})!`, { title: 'Invite Accepted', subtitle: 'Squad Invite' }));
    if (trackingMessage) {
        const trackingContainer = buildNoticeContainer({ title: 'Invite Accepted', subtitle: squadName, lines: [`<@${member.id}> accepted invite from <@${commandUserID}> to join **${squadName}** (${squadType}).`] });
        await trackingMessage.edit({ flags: MessageFlags.IsComponentsV2, components: [trackingContainer] }).catch(e => logger.error('tracking edit fail:', e));
    }
    try { await updateInviteStatus(interaction.message.id, 'Accepted'); } catch (apiError) { logger.error('API Error updating invite status:', apiError.message); }

    const defaultEventSquad = 'N/A';
    const defaultOpenSquad = 'FALSE';
    const defaultIsLeader = 'No';
    let existingPreference = 'TRUE';
    let eventSquadNameToAssign = null;

    const leaderRow = squadLeadersData.find(row => row && row.length > SL_SQUAD_NAME && row[SL_SQUAD_NAME] === squadName);
    if (leaderRow) {
        const leaderEventSquad = leaderRow[SL_EVENT_SQUAD];
        if (leaderEventSquad && leaderEventSquad !== 'N/A') {
            eventSquadNameToAssign = leaderEventSquad;
        }
    }

    const userInAllDataIndex = allDataHeaderless.findIndex(row => row && row.length > AD_ID && row[AD_ID] === invitedMemberId);

    if (userInAllDataIndex !== -1) {
        const sheetRowIndex = userInAllDataIndex + 2;
        const existingRow = allDataHeaderless[userInAllDataIndex];
        if (existingRow.length > AD_PREFERENCE && (existingRow[AD_PREFERENCE] === 'TRUE' || existingRow[AD_PREFERENCE] === 'FALSE')) {
            existingPreference = existingRow[AD_PREFERENCE];
        }
        const updatedRowData = [member.user.username, member.id, squadName, squadType, eventSquadNameToAssign || defaultEventSquad, defaultOpenSquad, defaultIsLeader, existingPreference];
        await sheets.spreadsheets.values.update({ spreadsheetId: SPREADSHEET_SQUADS, range: `All Data!A${sheetRowIndex}:H${sheetRowIndex}`, valueInputOption: 'RAW', resource: { values: [updatedRowData] } }).catch(err => { throw new Error(`Failed to update All Data sheet: ${err.message}`); });
    } else {
        const newRowData = [member.user.username, member.id, squadName, squadType, eventSquadNameToAssign || defaultEventSquad, defaultOpenSquad, defaultIsLeader, existingPreference];
        await sheets.spreadsheets.values.append({ spreadsheetId: SPREADSHEET_SQUADS, range: 'All Data!A1', valueInputOption: 'RAW', resource: { values: [newRowData] } }).catch(err => { throw new Error(`Failed to append to All Data sheet: ${err.message}`); });
    }

    const currentDate = new Date();
    const dateString = `${(currentDate.getMonth() + 1).toString().padStart(2, '0')}/${currentDate.getDate().toString().padStart(2, '0')}/${currentDate.getFullYear().toString().slice(-2)}`;
    const newSquadMemberRow = [member.user.username, member.id, squadName, eventSquadNameToAssign || defaultEventSquad, dateString];
    await sheets.spreadsheets.values.append({ spreadsheetId: SPREADSHEET_SQUADS, range: 'Squad Members!A1', valueInputOption: 'RAW', resource: { values: [newSquadMemberRow] } }).catch(err => { throw new Error(`Failed to append to Squad Members sheet: ${err.message}`); });

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

    // Assign level role for competitive squads
    await assignLevelRoleOnJoin(guild, invitedMemberId, squadName).catch(e =>
        logger.error(`[Invite Accept] Failed to assign level role to ${invitedMemberId}:`, e.message)
    );

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
    await commandUser.send({ flags: MessageFlags.IsComponentsV2, components: [dmContainer] }).catch(err => { logger.info(`Failed to DM command user ${commandUserID}: ${err.message}`); });

    try { await deleteInvite(interaction.message.id); } catch (apiError) { logger.error('API Error deleting invite:', apiError.message); }
};

const handleRejectInvite = async (interaction, ctx) => {
    const { squadName, trackingMessage, commandUserID, invitedMemberId, commandUser, inviteMessage } = ctx;

    await interaction.editReply({ ...noticePayload('You have rejected the invite.', { title: 'Invite Rejected', subtitle: 'Squad Invite' }), ephemeral: true });

    if (trackingMessage) {
        const trackingContainer = buildNoticeContainer({ title: 'Invite Rejected', subtitle: squadName, lines: [`<@${invitedMemberId}> rejected invite from <@${commandUserID}> for **${squadName}**.`] });
        await trackingMessage.edit({ flags: MessageFlags.IsComponentsV2, components: [trackingContainer] }).catch(e => logger.error('tracking edit fail:', e));
    }
    try { await updateInviteStatus(interaction.message.id, 'Rejected'); } catch (apiError) { logger.error('API Error updating status:', apiError.message); }

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
    await commandUser.send({ flags: MessageFlags.IsComponentsV2, components: [dmRejectionContainer] }).catch(err => { logger.info(`Failed to DM command user about rejection: ${err.message}`); });

    try { await deleteInvite(interaction.message.id); } catch (apiError) { logger.error('API Error deleting rejected invite:', apiError.message); }
};

module.exports = {
    handleInviteButton,
};
