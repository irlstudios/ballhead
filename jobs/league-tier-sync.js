'use strict';

const logger = require('../utils/logger');
const { fetchLeaguesForTierSync, setLeagueType } = require('../db');
const { decideTierMoves } = require('../utils/league_tier_sync');
const { noticePayload } = require('../utils/ui');
const {
    GYM_CLASS_GUILD_ID,
    LEAGUE_LOG_CHANNEL_ID,
    BASE_LEAGUE_ROLE_ID,
    ACTIVE_LEAGUE_ROLE_ID,
} = require('../config/constants');

const DELAY_MS = 300;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Returns true only when the owner is in the guild and holds the new tier
// role afterwards. Add first, remove second: if the add fails the owner still
// has their old role and the transition aborts cleanly; the old-role removal
// is best-effort.
async function swapTierRoles(guild, ownerId, removeRoleId, addRoleId) {
    const member = await guild.members.fetch(ownerId.toString()).catch(() => null);
    if (!member) {
        return false;
    }
    try {
        await member.roles.add(addRoleId);
    } catch (error) {
        logger.error(`[Tier Sync] Could not add role to ${ownerId}: ${error.message}`);
        return false;
    }
    await member.roles.remove(removeRoleId).catch((error) => {
        logger.info(`[Tier Sync] Could not remove role from ${ownerId}: ${error.message}`);
    });
    return true;
}

async function dmOwner(client, ownerId, payload) {
    const user = await client.users.fetch(ownerId.toString()).catch(() => null);
    if (!user) {
        return;
    }
    await user.send(payload).catch((error) => {
        logger.info(`[Tier Sync] Could not DM ${ownerId}: ${error.message}`);
    });
}

// Order matters: roles first, then the conditional DB claim. If a role step
// fails, nothing was claimed and the next daily run retries the promotion
// (role operations are idempotent). If the claim fails, the league changed
// tier or status mid-run; the stray role swap is rare enough to hand to the
// error log rather than build a rollback path.
async function applyPromotion(client, guild, { league }) {
    const rolesSwapped = await swapTierRoles(guild, league.owner_id, BASE_LEAGUE_ROLE_ID, ACTIVE_LEAGUE_ROLE_ID);
    if (!rolesSwapped) {
        logger.info(`[Tier Sync] Skipping promotion of ${league.league_name}: owner roles could not be updated.`);
        return false;
    }
    const claimed = await setLeagueType(league.league_id, 'Active', 'Base');
    if (!claimed) {
        logger.error(`[Tier Sync] Promotion of ${league.league_name} not claimed; league changed mid-run. Owner roles may need a manual look.`);
        return false;
    }
    await dmOwner(client, league.owner_id, noticePayload(
        [
            `Your league **${league.league_name}** now meets every Active League requirement and has been promoted automatically.`,
            '',
            'Active unlocks certified officials for your games via **/league request-official**.',
            'To stay Active: keep checking in monthly, hold 40+ members, and avoid strikes.',
        ],
        { title: 'Promoted to Active League', subtitle: league.league_name }
    ));
    return true;
}

async function applyDemotion(client, guild, { league, checks }) {
    const rolesSwapped = await swapTierRoles(guild, league.owner_id, ACTIVE_LEAGUE_ROLE_ID, BASE_LEAGUE_ROLE_ID);
    if (!rolesSwapped) {
        logger.info(`[Tier Sync] Skipping demotion of ${league.league_name}: owner roles could not be updated.`);
        return false;
    }
    const claimed = await setLeagueType(league.league_id, 'Base', 'Active');
    if (!claimed) {
        logger.error(`[Tier Sync] Demotion of ${league.league_name} not claimed; league changed mid-run. Owner roles may need a manual look.`);
        return false;
    }
    const failed = checks.filter((c) => !c.ok);
    await dmOwner(client, league.owner_id, noticePayload(
        [
            `Your league **${league.league_name}** no longer meets the Active League retention requirements and has moved back to Base:`,
            '',
            ...failed.map((c) => `- ${c.label} (${c.detail})`),
            '',
            'Meet the Active requirements again and your league will be promoted automatically.',
            'Check where you stand anytime with **/league requirements**.',
        ],
        { title: 'Moved to Base League', subtitle: league.league_name }
    ));
    return true;
}

async function runLeagueTierSync(client) {
    logger.info('[Tier Sync] Starting daily league tier sync...');

    const leagues = await fetchLeaguesForTierSync();
    const { promotions, demotions } = decideTierMoves(leagues);

    if (promotions.length === 0 && demotions.length === 0) {
        logger.info(`[Tier Sync] Complete. ${leagues.length} leagues checked, no movements.`);
        return;
    }

    const guild = await client.guilds.fetch(GYM_CLASS_GUILD_ID);
    const promoted = [];
    const demoted = [];

    for (const promotion of promotions) {
        try {
            if (await applyPromotion(client, guild, promotion)) {
                promoted.push(promotion.league.league_name);
                logger.info(`[Tier Sync] Promoted ${promotion.league.league_name} (${promotion.league.league_id}) to Active.`);
            }
        } catch (error) {
            logger.error(`[Tier Sync] Failed to promote league ${promotion.league.league_id}:`, error);
        }
        await delay(DELAY_MS);
    }

    for (const demotion of demotions) {
        try {
            if (await applyDemotion(client, guild, demotion)) {
                demoted.push(demotion.league.league_name);
                logger.info(`[Tier Sync] Demoted ${demotion.league.league_name} (${demotion.league.league_id}) to Base.`);
            }
        } catch (error) {
            logger.error(`[Tier Sync] Failed to demote league ${demotion.league.league_id}:`, error);
        }
        await delay(DELAY_MS);
    }

    if (promoted.length > 0 || demoted.length > 0) {
        const logChannel = await client.channels.fetch(LEAGUE_LOG_CHANNEL_ID).catch(() => null);
        if (logChannel) {
            await logChannel.send(noticePayload(
                [
                    promoted.length > 0 ? `**Promoted to Active (${promoted.length}):** ${promoted.join(', ')}` : null,
                    demoted.length > 0 ? `**Moved to Base (${demoted.length}):** ${demoted.join(', ')}` : null,
                ].filter(Boolean),
                { title: 'League Tier Sync', subtitle: 'Daily Automatic Movement' }
            )).catch((error) => logger.error('[Tier Sync] Failed to post log:', error));
        }
    }

    logger.info(
        `[Tier Sync] Complete. Promoted: ${promoted.length}/${promotions.length}, Demoted: ${demoted.length}/${demotions.length}.`
    );
}

module.exports = { runLeagueTierSync };
