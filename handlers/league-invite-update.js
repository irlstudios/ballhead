'use strict';

const axios = require('axios');
const logger = require('../utils/logger');
const { noticePayload } = require('../utils/ui');
const { fetchLeaguesByOwner, updateLeagueInvite } = require('../db');

function extractInviteCode(url) {
    const match = url.match(/discord(?:app)?\.com\/invite\/([^/\s]+)/i)
        || url.match(/discord\.gg\/([^/\s]+)/i);
    return match ? match[1] : null;
}

function buildIconUrl(guildId, hash) {
    return hash ? `https://cdn.discordapp.com/icons/${guildId}/${hash}.png` : 'Not Available';
}

function buildBannerUrl(guildId, hash) {
    return hash ? `https://cdn.discordapp.com/banners/${guildId}/${hash}.png` : 'Not Available';
}

const handleUpdateLeagueInviteModal = async (interaction) => {
    await interaction.deferReply({ ephemeral: true });

    try {
        const newInvite = interaction.fields.getTextInputValue('new-invite-link');
        const userId = interaction.user.id;

        const leagues = await fetchLeaguesByOwner(userId);
        if (leagues.length === 0) {
            return interaction.editReply(
                noticePayload(
                    'You do not own any registered leagues.',
                    { title: 'No League Found', subtitle: 'Update Invite' }
                )
            );
        }

        const code = extractInviteCode(newInvite);
        if (!code) {
            return interaction.editReply(
                noticePayload(
                    'Invalid invite link format. Please provide a valid Discord invite link.',
                    { title: 'Invalid Invite', subtitle: 'Update Invite' }
                )
            );
        }

        let inviteData;
        try {
            const response = await axios.get(
                `https://discord.com/api/v10/invites/${code}`,
                {
                    params: { with_counts: true, with_expiration: true },
                    headers: { Authorization: `Bot ${process.env.TOKEN}` },
                }
            );
            inviteData = response.data;
        } catch (error) {
            return interaction.editReply(
                noticePayload(
                    'Could not resolve the invite link. Please check that it is valid.',
                    { title: 'Invite Resolution Failed', subtitle: 'Update Invite' }
                )
            );
        }

        if (inviteData.expires_at) {
            return interaction.editReply(
                noticePayload(
                    'Please provide an invite link that does not expire (set to "Never").',
                    { title: 'Invite Expires', subtitle: 'Update Invite' }
                )
            );
        }

        const guild = inviteData.guild;
        if (!guild) {
            return interaction.editReply(
                noticePayload(
                    'Invalid invite link or the guild is no longer available.',
                    { title: 'Invite Invalid', subtitle: 'Update Invite' }
                )
            );
        }

        const league = leagues.find(
            (l) => l.server_id && l.server_id.toString() === guild.id
        );

        if (!league) {
            return interaction.editReply(
                noticePayload(
                    'This invite does not match any of your registered league servers.',
                    { title: 'Server Mismatch', subtitle: 'Update Invite' }
                )
            );
        }

        const serverId = guild.id;
        const serverName = guild.name || 'Unknown Server Name';
        const memberCount = inviteData.approximate_member_count || null;
        const serverIcon = buildIconUrl(serverId, guild.icon);
        const serverBanner = buildBannerUrl(serverId, guild.banner);
        const vanityUrl = guild.vanity_url_code
            ? `https://discord.gg/${guild.vanity_url_code}`
            : 'Not Available';
        const serverDescription = guild.description || 'No description available';
        const serverFeatures = guild.features && guild.features.length > 0
            ? guild.features.join(', ')
            : 'None';

        await updateLeagueInvite(league.league_id, newInvite, {
            serverName,
            serverId,
            memberCount,
            serverIcon,
            serverBanner,
            vanityUrl,
            serverDescription,
            serverFeatures,
        });

        return interaction.editReply(
            noticePayload(
                `Invite link updated for **${league.league_name}**.`,
                { title: 'Invite Updated', subtitle: 'Update Invite' }
            )
        );
    } catch (error) {
        logger.error('[Update Invite] Error:', error);
        return interaction.editReply(
            noticePayload(
                'An error occurred while updating your invite link.',
                { title: 'Update Failed', subtitle: 'Update Invite' }
            )
        );
    }
};

module.exports = { handleUpdateLeagueInviteModal };
