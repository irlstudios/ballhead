'use strict';

const axios = require('axios');
const logger = require('../utils/logger');
const {
    fetchActiveLeagues,
    insertLeagueHealthLog,
    updateLeagueHealthData,
} = require('../db');
const { GYM_CLASS_GUILD_ID } = require('../config/constants');

const DELAY_MS = 1000;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function extractInviteCode(url) {
    if (!url) return null;
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

async function runLeagueHealthCheck(client) {
    logger.info('[Health Check] Starting weekly league health check...');

    const leagues = await fetchActiveLeagues();
    if (leagues.length === 0) {
        logger.info('[Health Check] No active leagues to check.');
        return;
    }

    let checked = 0;
    let invalidInvites = 0;
    let ownersGone = 0;

    for (const league of leagues) {
        let inviteValid = false;
        let memberCount = null;
        let ownerInGuild = false;

        const code = extractInviteCode(league.league_invite);

        if (code) {
            try {
                const response = await axios.get(
                    `https://discord.com/api/v10/invites/${code}`,
                    {
                        params: { with_counts: true, with_expiration: true },
                        headers: { Authorization: `Bot ${process.env.TOKEN}` },
                    }
                );
                const data = response.data;
                const guild = data.guild;

                if (guild) {
                    inviteValid = true;
                    memberCount = data.approximate_member_count || null;

                    const serverName = guild.name || 'Unknown Server Name';
                    const serverId = guild.id;
                    const serverIcon = buildIconUrl(serverId, guild.icon);
                    const serverBanner = buildBannerUrl(serverId, guild.banner);
                    const vanityUrl = guild.vanity_url_code
                        ? `https://discord.gg/${guild.vanity_url_code}`
                        : 'Not Available';
                    const serverDescription = guild.description || 'No description available';
                    const serverFeatures = guild.features && guild.features.length > 0
                        ? guild.features.join(', ')
                        : 'None';

                    await updateLeagueHealthData(league.league_id, {
                        serverName,
                        memberCount,
                        serverIcon,
                        serverBanner,
                        vanityUrl,
                        serverDescription,
                        serverFeatures,
                    });
                }
            } catch (error) {
                const status = error.response?.status;
                if (status === 404) {
                    invalidInvites += 1;
                    try {
                        const owner = await client.users.fetch(league.owner_id.toString());
                        await owner.send(
                            `Your league invite for **${league.league_name}** is no longer valid. ` +
                            'Please update it with `/update-league-invite` before the end of the month ' +
                            'or your league will be marked inactive.'
                        ).catch(() => {});
                    } catch (dmError) {
                        logger.error(`[Health Check] Failed to DM owner ${league.owner_id}:`, dmError);
                    }
                } else {
                    logger.error(`[Health Check] Error resolving invite for league ${league.league_id}:`, error.message);
                }
            }
        }

        try {
            const gymGuild = await client.guilds.fetch(GYM_CLASS_GUILD_ID);
            const member = await gymGuild.members.fetch(league.owner_id.toString()).catch(() => null);
            ownerInGuild = member !== null;
            if (!ownerInGuild) {
                ownersGone += 1;
            }
        } catch (error) {
            logger.error(`[Health Check] Error checking guild membership for ${league.owner_id}:`, error.message);
        }

        await insertLeagueHealthLog(league.league_id, inviteValid, memberCount, ownerInGuild);

        checked += 1;
        await delay(DELAY_MS);
    }

    logger.info(
        `[Health Check] Complete. Checked: ${checked}, Invalid invites: ${invalidInvites}, Owners gone: ${ownersGone}`
    );
}

module.exports = { runLeagueHealthCheck };
