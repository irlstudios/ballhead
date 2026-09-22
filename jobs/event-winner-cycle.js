'use strict';

// Bi-weekly Top Event Winner cycle: counts the session wins EMH hosts recorded
// with /room event winner, announces the standings, and moves the role to
// whoever led the closed cycle.
//
// Runs daily and does nothing until a cycle has closed and not yet been
// claimed, so the schedule is a fixed 14-day calendar rather than a function of
// when the bot last restarted.

const logger = require('../utils/logger');
const store = require('../utils/event_winner_queries');
const { completedCycle, cycleLabel, announcementText, todayLocal, TOP_LISTED } = require('../utils/event_winner_cycle');
const {
    GYM_CLASS_GUILD_ID,
    EVENT_WINNER_CHANNEL_ID,
    TOP_EVENT_WINNER_ROLE_ID,
} = require('../config/constants');

const ROLE_REASON = 'Top Event Winner cycle';

// Everyone who should not be holding the role once this cycle is settled: the
// members the cache knows have it, plus the previous cycle's winner, who is the
// one holder guaranteed to be found.
// ponytail: role.members is cache only, so a role handed out by hand while the
// bot was down may survive. Fetching the full member list every cycle to catch
// that costs far more than the stray role does.
const staleHolderIds = (role, previousWinnerId, championId) => {
    const ids = new Set(role.members.map((member) => member.id));
    if (previousWinnerId) ids.add(previousWinnerId);
    ids.delete(championId);
    return [...ids];
};

// Never throws: a role the bot cannot move must not stop the announcement, and
// the announcement is what the members actually see.
const moveRole = async ({ guild, championId, previousWinnerId }) => {
    if (!TOP_EVENT_WINNER_ROLE_ID) {
        logger.info('[Event Winner] TOP_EVENT_WINNER_ROLE_ID is unset; announcing without moving a role.');
        return;
    }
    const role = await guild.roles.fetch(TOP_EVENT_WINNER_ROLE_ID).catch(() => null);
    if (!role) {
        logger.error(`[Event Winner] Role ${TOP_EVENT_WINNER_ROLE_ID} not found in guild ${guild.id}; nobody was given it.`);
        return;
    }
    // Checked once, up front: a role sitting above the bot fails per member with
    // a bare Missing Permissions, which says nothing about how to fix it.
    if (!role.editable) {
        logger.error(`[Event Winner] Role ${role.name} is above the bot's highest role or Manage Roles is missing, so it cannot be moved.`);
        return;
    }

    // The champion is given the role before anyone is stripped of it. If the
    // grant fails, the previous winner keeping it is a better state than the
    // role belonging to nobody until the next cycle.
    const champion = await guild.members.fetch(championId).catch(() => null);
    if (!champion) {
        logger.error(`[Event Winner] Champion ${championId} is no longer in the guild; the role was not moved.`);
        return;
    }
    if (!champion.roles.cache.has(role.id)) {
        const granted = await champion.roles.add(role, ROLE_REASON).then(() => true).catch((error) => {
            logger.error(`[Event Winner] Failed to give the role to ${championId}:`, error.message);
            return false;
        });
        if (!granted) return;
    }

    for (const staleId of staleHolderIds(role, previousWinnerId, championId)) {
        const member = await guild.members.fetch(staleId).catch(() => null);
        if (!member?.roles.cache.has(role.id)) continue;
        await member.roles.remove(role, ROLE_REASON)
            .catch((error) => logger.error(`[Event Winner] Failed to take the role back from ${staleId}:`, error.message));
    }
};

const runEventWinnerCycle = async (client, { todayISO = todayLocal() } = {}) => {
    const cycle = completedCycle(todayISO);
    if (!cycle) return null;

    const standings = await store.listCycleStandings(cycle);
    if (standings.length === 0) {
        // Not claimed: an empty cycle has nothing to announce, and leaving it
        // open costs one cheap query a day until wins appear or it rolls past.
        logger.info(`[Event Winner] No session wins recorded for ${cycleLabel(cycle)}; nothing to announce.`);
        return null;
    }

    // Resolved before the cycle is claimed, because a missing channel is the one
    // failure worth retrying tomorrow rather than burning the announcement on.
    const channel = await client.channels.fetch(EVENT_WINNER_CHANNEL_ID).catch(() => null);
    if (!channel?.isTextBased?.()) {
        logger.error(`[Event Winner] Announcement channel ${EVENT_WINNER_CHANNEL_ID} is missing or not text based; ${cycleLabel(cycle)} was left unclaimed.`);
        return null;
    }

    const [champion] = standings;
    const previousWinnerId = await store.getPreviousCycleWinnerId(cycle.start);
    const claimed = await store.claimCycle({
        ...cycle,
        winnerId: champion.userId,
        winnerName: champion.userName,
        wins: champion.wins,
    });
    // Claimed before anything is posted, so a failure further down cannot be
    // retried into a second announcement of the same cycle.
    if (!claimed) return null;

    const content = announcementText({ standings, cycle, roleId: TOP_EVENT_WINNER_ROLE_ID });
    await channel.send({
        content,
        // Only the members the post actually names, which also keeps the list
        // under the API's cap however long the standings run.
        allowedMentions: { users: standings.slice(0, TOP_LISTED).map((standing) => standing.userId) },
    // The cycle is already claimed and will not be retried, so the post is
    // logged in full and can be pasted by hand.
    }).catch((error) => logger.error(`[Event Winner] Failed to post the announcement, send it manually:\n${content}`, error.message));

    const guild = await client.guilds.fetch(GYM_CLASS_GUILD_ID).catch(() => null);
    if (guild) {
        await moveRole({ guild, championId: champion.userId, previousWinnerId });
    } else {
        logger.error(`[Event Winner] Guild ${GYM_CLASS_GUILD_ID} unavailable; the role was not moved.`);
    }

    logger.info(`[Event Winner] ${cycleLabel(cycle)} went to ${champion.userId} with ${champion.wins} win(s) over ${standings.length} contender(s).`);
    return { cycle, champion, standings };
};

module.exports = { runEventWinnerCycle, staleHolderIds };
