'use strict';

const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, ContainerBuilder, PermissionsBitField } = require('discord.js');
const axios = require('axios');
const logger = require('../utils/logger');
const { buildTextBlock, noticePayload } = require('../utils/ui');
const { buildLeagueGuidePayload } = require('../utils/league_guide');
const {
    findLeagueApplication,
    updateLeagueApplicationApproval,
    updateLeagueApplicationDenial,
    revertLeagueApplicationToPending,
    findActiveLeague,
    findActiveLeagueByOwnerAndName,
    findLeagueCreationBlock,
    insertActiveLeague,
    updateActiveLeague,
} = require('../db');
const {
    LEVEL_5_ROLE_ID,
    HIGHER_LEVEL_ROLES,
    BASE_LEAGUE_ROLE_ID,
    ACTIVE_LEAGUE_ROLE_ID,
    SPONSORED_LEAGUE_ROLE_ID,
    LEAGUE_OWNER_ROLE_ID,
    LEAGUE_LOG_CHANNEL_ID,
} = require('../config/constants');

const handleApplyBaseLeagueModal = async (interaction) => {
    await interaction.deferReply({ ephemeral: true });

    const leagueName = interaction.fields.getTextInputValue('league-name');
    const discordInvite = interaction.fields.getTextInputValue('discord-invite');

    const userRoles = interaction.member.roles.cache;
    const hasRequiredRole = userRoles.has(LEVEL_5_ROLE_ID) || HIGHER_LEVEL_ROLES.some(roleId => userRoles.has(roleId));

    if (!hasRequiredRole) {
        return await interaction.editReply(
            noticePayload(
                'You need to be at least Level 5 to apply for a Base League. Try chatting with the community more to gain more level, best of luck!',
                { title: 'Eligibility Required', subtitle: 'Base League' }
            )
        );
    }

    try {
        // Users whose league was force-disbanded with the block flag may not
        // register a new league.
        const creationBlock = await findLeagueCreationBlock(interaction.user.id);
        if (creationBlock) {
            return await interaction.editReply(
                noticePayload(
                    [
                        'You are not permitted to register a new league.',
                        '',
                        '-# If you believe this is an error, please open a ticket so our team can review it.',
                    ],
                    { title: 'Registration Blocked', subtitle: 'Base League' }
                )
            );
        }

        const inviteCodeMatch = discordInvite.match(/discord(?:app)?\.com\/invite\/([^/\s]+)/i) || discordInvite.match(/discord\.gg\/([^/\s]+)/i);
        if (!inviteCodeMatch) {
            return await interaction.editReply(
                noticePayload(
                    'Invalid invite link format. Please provide a valid Discord invite link.',
                    { title: 'Invalid Invite', subtitle: 'Base League' }
                )
            );
        }
        const inviteCode = inviteCodeMatch[1];

        const inviteResponse = await axios.get(`https://discord.com/api/v10/invites/${inviteCode}`, {
            params: { with_counts: true, with_expiration: true, with_metadata: true },
            headers: { Authorization: `Bot ${process.env.TOKEN}` },
        });

        const inviteData = inviteResponse.data;

        if (inviteData.expires_at) {
            return await interaction.editReply(
                noticePayload(
                    'Please provide an invite link that does not expire (set to "Never").',
                    { title: 'Invite Expired', subtitle: 'Base League' }
                )
            );
        }

        const guild = inviteData.guild;
        if (!guild) {
            return await interaction.editReply(
                noticePayload(
                    'Invalid invite link or the guild is no longer available.',
                    { title: 'Invite Invalid', subtitle: 'Base League' }
                )
            );
        }

        const serverName = guild.name || 'Unknown Server Name';
        const serverId = guild.id || 'Unknown Server ID';
        const memberCount = inviteData.approximate_member_count || 0;
        const serverIcon = guild.icon ? `https://cdn.discordapp.com/icons/${serverId}/${guild.icon}.png` : 'Not Available';
        const serverBanner = guild.banner ? `https://cdn.discordapp.com/banners/${serverId}/${guild.banner}.png` : 'Not Available';
        const vanityUrl = guild.vanity_url_code ? `https://discord.gg/${guild.vanity_url_code}` : 'Not Available';
        const serverDescription = guild.description || 'No description available';
        const serverFeatures = guild.features.length > 0 ? guild.features.join(', ') : 'None';

        const user = interaction.user;
        const ownerProfilePicture = user.avatar
            ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
            : 'https://cdn.discordapp.com/embed/avatars/0.png';

        const existingServer = await findActiveLeague('server_id', serverId);
        if (existingServer.length > 0) {
            return await interaction.editReply(
                noticePayload(
                    [
                        'This server is already registered as a league. Each server can only be registered once.',
                        '',
                        '-# If you believe this is an error or want to dispute ownership, please open a ticket so our team can help resolve it.',
                    ],
                    { title: 'Already Registered', subtitle: 'Base League' }
                )
            );
        }

        const existingLeague = await findActiveLeague('owner_id', user.id);
        if (existingLeague.length > 0) {
            return await interaction.editReply(
                noticePayload(
                    'You already own a registered league. Each member can only own one league.',
                    { title: 'Application Blocked', subtitle: 'Base League' }
                )
            );
        }

        try {
            await insertActiveLeague([
                user.id, user.username, leagueName, serverName, serverId, memberCount, user.id,
                'Base', false, discordInvite, serverIcon, serverBanner, vanityUrl,
                serverDescription, serverFeatures, ownerProfilePicture,
            ]);
        } catch (insErr) {
            // Unique-index backstop (one live league per owner / per server):
            // a concurrent submission won the check-then-insert race.
            if (insErr.code === '23505') {
                return await interaction.editReply(
                    noticePayload(
                        'You already own a registered league, or this server is already registered.',
                        { title: 'Application Blocked', subtitle: 'Base League' }
                    )
                );
            }
            throw insErr;
        }

        // Grant the tier role (Base League Owner) and the general League Owner role.
        // Add each independently by ID so a failure on one role cannot block or
        // silently swallow the other, and so failures are surfaced in the logs.
        for (const roleId of [BASE_LEAGUE_ROLE_ID, LEAGUE_OWNER_ROLE_ID]) {
            await interaction.member.roles.add(roleId).catch((error) => {
                logger.error(`Failed to assign role ${roleId} to league owner ${user.id}:`, error.message);
            });
        }

        // Onboarding: new owners should not have to guess how the program
        // works. DM first so the confirmation can say whether it arrived.
        const guideDelivered = await user.send(buildLeagueGuidePayload())
            .then(() => true)
            .catch((error) => {
                logger.info(`Could not DM the league guide to ${user.id}: ${error.message}`);
                return false;
            });

        await interaction.editReply(
            noticePayload(
                [
                    'Your Base League has been registered successfully!',
                    guideDelivered
                        ? 'The League Owner Guide has been sent to your DMs - bring it back anytime with **/league guide**.'
                        : 'We could not DM you the League Owner Guide (your DMs may be closed) - read it anytime with **/league guide**.',
                ],
                { title: 'Base League Registered', subtitle: leagueName }
            )
        );

        const logChannel = await interaction.client.channels.fetch(LEAGUE_LOG_CHANNEL_ID).catch(() => null);
        if (logChannel) {
            const leagueContainer = new ContainerBuilder();
            const block = buildTextBlock({
                title: 'New Base League Registered',
                subtitle: leagueName,
                lines: [
                    `**Owner:** <@${user.id}>`,
                    `**Server Name:** ${serverName}`,
                    `**Invite Link:** ${discordInvite}`,
                    `**Member Count:** ${memberCount.toString()}`,
                ],
            });
            if (block) leagueContainer.addTextDisplayComponents(block);
            await logChannel.send({ flags: MessageFlags.IsComponentsV2, components: [leagueContainer] });
        } else {
            logger.error('Log channel not found.');
        }
    } catch (error) {
        logger.error('Error in handleApplyBaseLeagueModal:', error);
        const errorPayload = noticePayload(
            'An error occurred while processing your application.',
            { title: 'Application Failed', subtitle: 'Base League' }
        );
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ ...errorPayload, ephemeral: true });
        } else {
            await interaction.editReply(errorPayload);
        }
    }
};

const handleApproveLeague = async (interaction) => {
    await interaction.deferReply({ ephemeral: true });

    let claimedMessageId = null;
    try {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
            return await interaction.editReply(
                noticePayload('You do not have permission to approve league applications.', { title: 'Permission Denied', subtitle: 'League Applications' })
            );
        }

        const messageId = interaction.message.id;
        const rows = await findLeagueApplication(messageId);
        if (rows.length === 0) {
            return await interaction.editReply(
                noticePayload('League application not found.', { title: 'Not Found', subtitle: 'League Applications' })
            );
        }

        const application = rows[0];
        const member = await interaction.guild.members.fetch(application.applicant_id).catch(() => null);
        if (!member) {
            return await interaction.editReply(
                noticePayload('Could not fetch the applicant. They may have left the server.', { title: 'Member Unavailable', subtitle: 'League Applications' })
            );
        }

        // Atomic Pending-only claim: a double click or a concurrent deny loses
        // here and nothing below runs twice.
        const claimed = await updateLeagueApplicationApproval(messageId, interaction.user.id);
        if (!claimed) {
            return await interaction.editReply(
                noticePayload('This application has already been reviewed.', { title: 'Already Handled', subtitle: 'League Applications' })
            );
        }
        claimedMessageId = messageId;

        // Null fields mean "could not resolve": the update path keeps existing
        // values via COALESCE, and the insert path falls back to placeholders.
        let serverData = {
            serverName: null, serverId: null, memberCount: null,
            serverIcon: null, serverBanner: null, vanityUrl: null,
            serverDescription: null, serverFeatures: null,
        };

        try {
            const invite = await interaction.client.fetchInvite(application.league_invite);
            const guild = invite.guild;
            if (guild) {
                const rawCount = guild.memberCount || guild.approximateMemberCount || null;
                serverData = {
                    serverName: guild.name || null,
                    serverId: guild.id || null,
                    memberCount: isNaN(rawCount) ? null : rawCount,
                    serverIcon: guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png` : null,
                    serverBanner: guild.banner ? `https://cdn.discordapp.com/banners/${guild.id}/${guild.banner}.png` : null,
                    vanityUrl: guild.vanityURLCode ? `https://discord.gg/${guild.vanityURLCode}` : null,
                    serverDescription: guild.description || null,
                    serverFeatures: guild.features.length > 0 ? guild.features.join(', ') : null,
                };
            }
        } catch (error) {
            logger.error('Error fetching guild from invite:', error);
        }

        const ownerProfilePicture = member.user.avatar
            ? `https://cdn.discordapp.com/avatars/${member.user.id}/${member.user.avatar}.png`
            : 'https://cdn.discordapp.com/embed/avatars/0.png';

        const leagueRes = await findActiveLeagueByOwnerAndName(application.applicant_id, application.league_name);

        if (leagueRes.length > 0) {
            await updateActiveLeague([
                application.applied_league_level, serverData.serverId, serverData.serverName,
                serverData.memberCount, serverData.serverIcon, serverData.serverBanner,
                serverData.vanityUrl, serverData.serverDescription, serverData.serverFeatures,
                ownerProfilePicture, application.applicant_id, application.league_name,
            ]);
        } else {
            await insertActiveLeague([
                application.applicant_id, application.applicant_discord_name, application.league_name,
                serverData.serverName ?? 'Unknown Server Name', serverData.serverId ?? 'Unknown Server ID',
                serverData.memberCount, application.applicant_id,
                application.applied_league_level, application.applied_league_level === 'Sponsored',
                application.league_invite, serverData.serverIcon ?? 'Not Available', serverData.serverBanner ?? 'Not Available',
                serverData.vanityUrl ?? 'Not Available', serverData.serverDescription ?? 'No description available',
                serverData.serverFeatures ?? 'None', ownerProfilePicture,
            ]);
        }

        let oldRoleId, newRoleId;
        if (application.applied_league_level === 'Active') {
            oldRoleId = BASE_LEAGUE_ROLE_ID;
            newRoleId = ACTIVE_LEAGUE_ROLE_ID;
        } else if (application.applied_league_level === 'Sponsored') {
            oldRoleId = ACTIVE_LEAGUE_ROLE_ID;
            newRoleId = SPONSORED_LEAGUE_ROLE_ID;
        }

        // Add first, remove second (mirrors the tier sync): a failed removal
        // leaves an extra role, never a missing one, and neither failure
        // aborts the rest of the approval.
        if (newRoleId) {
            await member.roles.add(newRoleId).catch((error) => {
                logger.error(`Failed to add ${application.applied_league_level} role to ${member.id}:`, error.message);
            });
        }
        if (oldRoleId) {
            await member.roles.remove(oldRoleId).catch((error) => {
                logger.error(`Failed to remove old tier role from ${member.id}:`, error.message);
            });
        }

        try {
            const dmContainer = new ContainerBuilder();
            const block = buildTextBlock({
                title: 'League Application Approved',
                subtitle: application.league_name,
                lines: [
                    `Your application to upgrade to **${application.applied_league_level} League** has been approved.`,
                    'Please navigate to #league-owners for further instructions.',
                ],
            });
            if (block) dmContainer.addTextDisplayComponents(block);
            // Independent sends: a failed approval notice must not also cost
            // the owner their guide, and vice versa.
            await member.send({ flags: MessageFlags.IsComponentsV2, components: [dmContainer] })
                .catch((error) => logger.error('Error sending approval DM to the applicant:', error));
            await member.send(buildLeagueGuidePayload())
                .catch((error) => logger.error('Error sending league guide DM to the applicant:', error));
        } catch (error) {
            logger.error('Error sending DM to the applicant:', error);
        }

        // Point of no return: once the card below loses its Approve/Deny
        // buttons, reverting the claim would strand a Pending application no
        // one can click. Everything before this is idempotent on retry.
        claimedMessageId = null;

        const leagueApprovedContainer = new ContainerBuilder();
        const block = buildTextBlock({
            title: 'League Application Approved',
            subtitle: application.league_name,
            lines: ['This application has been approved.'],
        });
        if (block) leagueApprovedContainer.addTextDisplayComponents(block);
        await interaction.message.edit({ flags: MessageFlags.IsComponentsV2, components: [leagueApprovedContainer] });

        await interaction.editReply(
            noticePayload('Application has been approved.', { title: 'Approved', subtitle: application.league_name })
        );
    } catch (error) {
        logger.error('Error in handleApproveLeague:', error);
        // Compensating revert: give the claim back so the reviewer can retry
        // instead of being told the application was already handled.
        if (claimedMessageId) {
            await revertLeagueApplicationToPending(claimedMessageId)
                .catch((revertError) => logger.error('Failed to revert application claim:', revertError));
        }
        await interaction.editReply(
            noticePayload('An error occurred while approving the application. Nothing was finalized; you can retry.', { title: 'Approval Failed', subtitle: 'League Applications' })
        ).catch((replyError) => logger.error('Error replying to interaction:', replyError));
    }
};

const handleDenyLeagueModal = async (interaction) => {
    await interaction.deferReply({ ephemeral: true });

    try {
        const denialReason = interaction.fields.getTextInputValue('denial-reason');
        const [, messageId] = interaction.customId.split(':');

        const rows = await findLeagueApplication(messageId);
        if (rows.length === 0) {
            await interaction.editReply(
                noticePayload('League application not found.', { title: 'Not Found', subtitle: 'League Applications' })
            );
            return;
        }

        const application = rows[0];

        let member;
        try {
            member = await interaction.guild.members.fetch(application.applicant_id);
        } catch (error) {
            logger.error('Error fetching member:', error);
            await interaction.editReply(
                noticePayload('Could not fetch the applicant.', { title: 'Member Unavailable', subtitle: 'League Applications' })
            );
            return;
        }

        // Atomic Pending-only claim, mirroring handleApproveLeague.
        const claimed = await updateLeagueApplicationDenial(messageId, denialReason, interaction.user.id);
        if (!claimed) {
            await interaction.editReply(
                noticePayload('This application has already been reviewed.', { title: 'Already Handled', subtitle: 'League Applications' })
            );
            return;
        }

        try {
            const dmContainer = new ContainerBuilder();
            const block = buildTextBlock({
                title: 'League Application Denied',
                subtitle: application.league_name,
                lines: [
                    'Your application to upgrade your league has been denied.',
                    `**Reason:** ${denialReason}`,
                    'A Community Developer will follow up with more details.',
                ],
            });
            if (block) dmContainer.addTextDisplayComponents(block);
            await member.send({ flags: MessageFlags.IsComponentsV2, components: [dmContainer] });
        } catch (error) {
            logger.error('Error sending DM to the applicant:', error);
        }

        try {
            const message = await interaction.channel.messages.fetch(messageId);
            const leagueDeniedContainer = new ContainerBuilder();
            const block = buildTextBlock({
                title: 'League Application Denied',
                subtitle: application.league_name,
                lines: ['This application has been denied.'],
            });
            if (block) leagueDeniedContainer.addTextDisplayComponents(block);
            await message.edit({ flags: MessageFlags.IsComponentsV2, components: [leagueDeniedContainer] });
        } catch (error) {
            logger.error('Error updating application message:', error);
        }

        await interaction.editReply(
            noticePayload('Application has been denied.', { title: 'Denied', subtitle: application.league_name })
        );
    } catch (error) {
        logger.error('Error in handleDenyLeagueModal:', error);
        await interaction.editReply(
            noticePayload('An error occurred while processing the denial.', { title: 'Denial Failed', subtitle: 'League Applications' })
        ).catch(replyError => logger.error('Error replying to interaction:', replyError));
    }
};

const handleDenyLeagueButton = async (interaction) => {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
        return await interaction.reply({
            ...noticePayload('You do not have permission to deny league applications.', { title: 'Permission Denied', subtitle: 'League Applications' }),
            ephemeral: true,
        });
    }

    const modal = new ModalBuilder()
        .setCustomId(`denyLeagueModal:${interaction.message.id}`)
        .setTitle('Deny League Application');

    const denialReasonInput = new TextInputBuilder()
        .setCustomId('denial-reason')
        .setLabel('Reason for Denial')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

    const firstActionRow = new ActionRowBuilder().addComponents(denialReasonInput);
    modal.addComponents(firstActionRow);
    await interaction.showModal(modal);
};

module.exports = {
    handleApplyBaseLeagueModal,
    handleApproveLeague,
    handleDenyLeagueModal,
    handleDenyLeagueButton,
};
