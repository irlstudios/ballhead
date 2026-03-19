'use strict';

const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, ContainerBuilder, PermissionsBitField } = require('discord.js');
const axios = require('axios');
const logger = require('../utils/logger');
const { buildTextBlock, noticePayload } = require('../utils/ui');
const {
    findLeagueApplication,
    updateLeagueApplicationApproval,
    updateLeagueApplicationDenial,
    findActiveLeague,
    findActiveLeagueByOwnerAndName,
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
                    'This server is already registered as a Base League.',
                    { title: 'Already Registered', subtitle: 'Base League' }
                )
            );
        }

        const existingLeague = await findActiveLeague('owner_id', user.id);
        if (existingLeague.length > 0) {
            return await interaction.editReply(
                noticePayload(
                    'You already own a Base League.',
                    { title: 'Application Blocked', subtitle: 'Base League' }
                )
            );
        }

        await insertActiveLeague([
            user.id, user.username, leagueName, serverName, serverId, memberCount, user.id,
            'Base', false, discordInvite, serverIcon, serverBanner, vanityUrl,
            serverDescription, serverFeatures, ownerProfilePicture,
        ]);

        const baseRole = interaction.guild.roles.cache.get(BASE_LEAGUE_ROLE_ID);
        const mainRole = interaction.guild.roles.cache.get(LEAGUE_OWNER_ROLE_ID);
        if (baseRole) {
            await interaction.member.roles.add(baseRole);
            if (mainRole) await interaction.member.roles.add(mainRole);
        } else {
            logger.error(`Role with ID ${BASE_LEAGUE_ROLE_ID} not found.`);
        }

        await interaction.editReply(
            noticePayload(
                'Your Base League has been registered successfully!',
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
    try {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
            return await interaction.reply({
                ...noticePayload('You do not have permission to approve league applications.', { title: 'Permission Denied', subtitle: 'League Applications' }),
                ephemeral: true,
            });
        }

        const messageId = interaction.message.id;
        const rows = await findLeagueApplication(messageId);
        if (rows.length === 0) {
            return await interaction.reply({
                ...noticePayload('League application not found.', { title: 'Not Found', subtitle: 'League Applications' }),
                ephemeral: true,
            });
        }

        const application = rows[0];
        const member = await interaction.guild.members.fetch(application.applicant_id);

        await updateLeagueApplicationApproval(messageId, interaction.user.id);

        let serverData = {
            serverName: 'Unknown Server Name', serverId: 'Unknown Server ID', memberCount: null,
            serverIcon: 'Not Available', serverBanner: 'Not Available', vanityUrl: 'Not Available',
            serverDescription: 'No description available', serverFeatures: 'None',
        };

        try {
            const invite = await interaction.client.fetchInvite(application.league_invite);
            const guild = invite.guild;
            if (guild) {
                const rawCount = guild.memberCount || guild.approximateMemberCount || null;
                serverData = {
                    serverName: guild.name || serverData.serverName,
                    serverId: guild.id || serverData.serverId,
                    memberCount: isNaN(rawCount) ? null : rawCount,
                    serverIcon: guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png` : serverData.serverIcon,
                    serverBanner: guild.banner ? `https://cdn.discordapp.com/banners/${guild.id}/${guild.banner}.png` : serverData.serverBanner,
                    vanityUrl: guild.vanityURLCode ? `https://discord.gg/${guild.vanityURLCode}` : serverData.vanityUrl,
                    serverDescription: guild.description || serverData.serverDescription,
                    serverFeatures: guild.features.length > 0 ? guild.features.join(', ') : serverData.serverFeatures,
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
                serverData.serverName, serverData.serverId, serverData.memberCount, application.applicant_id,
                application.applied_league_level, application.applied_league_level === 'Sponsored',
                application.league_invite, serverData.serverIcon, serverData.serverBanner,
                serverData.vanityUrl, serverData.serverDescription, serverData.serverFeatures,
                ownerProfilePicture,
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

        if (oldRoleId) await member.roles.remove(oldRoleId);
        if (newRoleId) await member.roles.add(newRoleId);

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
            await member.send({ flags: MessageFlags.IsComponentsV2, components: [dmContainer] });
        } catch (error) {
            logger.error('Error sending DM to the applicant:', error);
        }

        const leagueApprovedContainer = new ContainerBuilder();
        const block = buildTextBlock({
            title: 'League Application Approved',
            subtitle: application.league_name,
            lines: ['This application has been approved.'],
        });
        if (block) leagueApprovedContainer.addTextDisplayComponents(block);
        await interaction.message.edit({ flags: MessageFlags.IsComponentsV2, components: [leagueApprovedContainer] });

        await interaction.reply({
            ...noticePayload('Application has been approved.', { title: 'Approved', subtitle: application.league_name }),
            ephemeral: true,
        });
    } catch (error) {
        logger.error('Error in handleApproveLeague:', error);
    }
};

const handleDenyLeagueModal = async (interaction) => {
    try {
        const denialReason = interaction.fields.getTextInputValue('denial-reason');
        const [, messageId] = interaction.customId.split(':');

        const rows = await findLeagueApplication(messageId);
        if (rows.length === 0) {
            await interaction.reply({
                ...noticePayload('League application not found.', { title: 'Not Found', subtitle: 'League Applications' }),
                ephemeral: true,
            });
            return;
        }

        const application = rows[0];

        let member;
        try {
            member = await interaction.guild.members.fetch(application.applicant_id);
        } catch (error) {
            logger.error('Error fetching member:', error);
            await interaction.reply({
                ...noticePayload('Could not fetch the applicant.', { title: 'Member Unavailable', subtitle: 'League Applications' }),
                ephemeral: true,
            });
            return;
        }

        await updateLeagueApplicationDenial(messageId, denialReason, interaction.user.id);

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

        await interaction.reply({
            ...noticePayload('Application has been denied.', { title: 'Denied', subtitle: application.league_name }),
            ephemeral: true,
        });
    } catch (error) {
        logger.error('Error in handleDenyLeagueModal:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                ...noticePayload('An error occurred while processing the denial.', { title: 'Denial Failed', subtitle: 'League Applications' }),
                ephemeral: true,
            }).catch(replyError => logger.error('Error replying to interaction:', replyError));
        }
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
