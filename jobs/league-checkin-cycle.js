'use strict';

const logger = require('../utils/logger');
const { MessageFlags, ContainerBuilder } = require('discord.js');
const { buildTextBlock } = require('../utils/ui');
const {
    fetchActiveLeagues,
    fetchCheckinForMonth,
    updateLeagueStatus,
} = require('../db');
const {
    GYM_CLASS_GUILD_ID,
    LEAGUE_LOG_CHANNEL_ID,
    LEAGUE_OWNER_ROLE_ID,
    LEAGUE_CO_OWNER_ROLE_ID,
    BASE_LEAGUE_ROLE_ID,
    ACTIVE_LEAGUE_ROLE_ID,
    SPONSORED_LEAGUE_ROLE_ID,
} = require('../config/constants');

const DELAY_MS = 1000;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getCurrentMonth() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
}

function getTierRoleId(leagueType) {
    const map = {
        'Base': BASE_LEAGUE_ROLE_ID,
        'Active': ACTIVE_LEAGUE_ROLE_ID,
        'Sponsored': SPONSORED_LEAGUE_ROLE_ID,
    };
    return map[leagueType] || null;
}

function getCoOwnerIds(league) {
    return [league.co_owner_1, league.co_owner_2].filter(Boolean);
}

async function sendCheckinReminder(client) {
    logger.info('[Checkin Cycle] Sending monthly check-in reminders...');

    const leagues = await fetchActiveLeagues();
    let sent = 0;

    for (const league of leagues) {
        try {
            const owner = await client.users.fetch(league.owner_id.toString());
            await owner.send(
                "It's time for your monthly league check-in. " +
                'Use `/league-checkin` in the Gym Class server to confirm your league is still active. ' +
                'Deadline: end of the month.'
            ).catch(() => {});
            sent += 1;
        } catch (error) {
            logger.error(`[Checkin Cycle] Failed to DM owner ${league.owner_id}:`, error.message);
        }
        await delay(DELAY_MS);
    }

    logger.info(`[Checkin Cycle] Reminders sent: ${sent}/${leagues.length}`);
}

async function sendCheckinWarning(client) {
    logger.info('[Checkin Cycle] Sending check-in warnings...');

    const leagues = await fetchActiveLeagues();
    const month = getCurrentMonth();
    let warned = 0;

    for (const league of leagues) {
        const checkins = await fetchCheckinForMonth(league.league_id, month);
        if (checkins.length > 0) {
            await delay(200);
            continue;
        }

        try {
            const owner = await client.users.fetch(league.owner_id.toString());
            await owner.send(
                "You haven't submitted your monthly check-in yet. " +
                'You have 7 days remaining before your league is marked inactive. ' +
                'Use `/league-checkin` in the Gym Class server to confirm.'
            ).catch(() => {});
            warned += 1;
        } catch (error) {
            logger.error(`[Checkin Cycle] Failed to warn owner ${league.owner_id}:`, error.message);
        }
        await delay(DELAY_MS);
    }

    logger.info(`[Checkin Cycle] Warnings sent: ${warned}`);
}

async function processCheckinDeadline(client) {
    logger.info('[Checkin Cycle] Processing check-in deadline...');

    const leagues = await fetchActiveLeagues();
    const month = getCurrentMonth();
    const gymGuild = await client.guilds.fetch(GYM_CLASS_GUILD_ID);

    const inactiveLeagues = [];
    let deactivated = 0;

    for (const league of leagues) {
        const checkins = await fetchCheckinForMonth(league.league_id, month);
        if (checkins.length > 0) {
            await delay(200);
            continue;
        }

        await updateLeagueStatus(league.league_id, 'Inactive');

        // Remove owner roles
        try {
            const member = await gymGuild.members.fetch(league.owner_id.toString()).catch(() => null);
            if (member) {
                await member.roles.remove(LEAGUE_OWNER_ROLE_ID).catch(() => {});
                const tierRoleId = getTierRoleId(league.league_type);
                if (tierRoleId) {
                    await member.roles.remove(tierRoleId).catch(() => {});
                }
            }
        } catch (error) {
            logger.error(`[Checkin Cycle] Failed to remove roles from owner ${league.owner_id}:`, error.message);
        }

        // Remove co-owner roles
        const coOwnerIds = getCoOwnerIds(league);
        for (const coOwnerId of coOwnerIds) {
            try {
                const coMember = await gymGuild.members.fetch(coOwnerId).catch(() => null);
                if (coMember) {
                    await coMember.roles.remove(LEAGUE_CO_OWNER_ROLE_ID).catch(() => {});
                }
            } catch (error) {
                logger.error(`[Checkin Cycle] Failed to remove co-owner role from ${coOwnerId}:`, error.message);
            }
        }

        // DM owner
        try {
            const owner = await client.users.fetch(league.owner_id.toString());
            await owner.send(
                `Your league **${league.league_name}** has been marked inactive due to a missed check-in. ` +
                'Use `/league-checkin` at any time to reactivate.'
            ).catch(() => {});
        } catch (error) {
            logger.error(`[Checkin Cycle] Failed to DM owner ${league.owner_id}:`, error.message);
        }

        // DM co-owners
        for (const coOwnerId of coOwnerIds) {
            try {
                const coOwner = await client.users.fetch(coOwnerId);
                await coOwner.send(
                    `The league **${league.league_name}** has been marked inactive due to a missed check-in. ` +
                    'Use `/league-checkin` at any time to help reactivate it.'
                ).catch(() => {});
            } catch (error) {
                logger.error(`[Checkin Cycle] Failed to DM co-owner ${coOwnerId}:`, error.message);
            }
            await delay(DELAY_MS);
        }

        inactiveLeagues.push(league.league_name);
        deactivated += 1;
        await delay(DELAY_MS);
    }

    const activeCount = leagues.length - deactivated;

    try {
        const logChannel = await client.channels.fetch(LEAGUE_LOG_CHANNEL_ID);
        const lines = [
            `**Active:** ${activeCount}`,
            `**Marked Inactive:** ${deactivated}`,
        ];
        if (inactiveLeagues.length > 0) {
            lines.push('', '**Inactive leagues:**');
            for (const name of inactiveLeagues) {
                lines.push(`- ${name}`);
            }
        }
        const container = new ContainerBuilder();
        const block = buildTextBlock({
            title: 'Monthly Check-in Summary',
            subtitle: month,
            lines,
        });
        if (block) container.addTextDisplayComponents(block);
        await logChannel.send({ flags: MessageFlags.IsComponentsV2, components: [container] });
    } catch (error) {
        logger.error('[Checkin Cycle] Failed to post summary:', error.message);
    }

    logger.info(`[Checkin Cycle] Deadline processed. Active: ${activeCount}, Deactivated: ${deactivated}`);
}

module.exports = { sendCheckinReminder, sendCheckinWarning, processCheckinDeadline };
