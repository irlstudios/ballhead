'use strict';

const { getSheetsClient, getCachedValues } = require('./sheets_cache');
const {
    SPREADSHEET_SQUADS,
    BALLHEAD_GUILD_ID,
} = require('../config/constants');
const { compSquadLevelRoles } = require('../config/squads');
const { calculateSquadWins } = require('./top_squad_sync');
const { findSquadMembers } = require('./squad_queries');
const logger = require('./logger');

/**
 * Calculate squad level from total wins.
 */
function getSquadLevel(totalWins) {
    return Math.floor(totalWins / 50) + 1;
}

/**
 * Get the appropriate level role for a given level.
 * Levels 1-3 map to indices 0-2, level 4+ maps to index 3.
 */
function getLevelRole(level) {
    const index = Math.min(level - 1, compSquadLevelRoles.length - 1);
    return compSquadLevelRoles[index] || null;
}

/**
 * Sync a single member's level role.
 */
async function syncMemberLevelRole(member, correctRoleId) {
    let updated = false;
    for (const roleId of compSquadLevelRoles) {
        const hasRole = member.roles.cache.has(roleId);
        if (roleId === correctRoleId && !hasRole) {
            await member.roles.add(roleId).catch(e =>
                logger.error(`[Level Sync] Failed to add role to ${member.id}:`, e.message)
            );
            updated = true;
        } else if (roleId !== correctRoleId && hasRole) {
            await member.roles.remove(roleId).catch(e =>
                logger.error(`[Level Sync] Failed to remove role from ${member.id}:`, e.message)
            );
        }
    }
    return updated;
}

/**
 * Sync level roles for all competitive squad members.
 */
async function syncLevelRoles(client) {
    const sheets = await getSheetsClient();
    const guild = await client.guilds.fetch(BALLHEAD_GUILD_ID);

    const squadWins = await calculateSquadWins(sheets);

    const squadsResults = await getCachedValues({
        sheets,
        spreadsheetId: SPREADSHEET_SQUADS,
        ranges: ['Squad Members!A:E', 'Squad Leaders!A:G'],
        ttlMs: 30000,
    });
    const squadMembersData = (squadsResults.get('Squad Members!A:E') || []).slice(1);
    const squadLeadersData = (squadsResults.get('Squad Leaders!A:G') || []).slice(1);

    const allGuildMembers = await guild.members.fetch();
    let updated = 0;

    // Build map: squadName (uppercase) -> level role ID
    const squadLevelMap = new Map();
    for (const [squadName, data] of squadWins) {
        if (data.squadType !== 'Competitive') continue;
        const level = getSquadLevel(data.totalWins);
        const roleId = getLevelRole(level);
        if (roleId) {
            squadLevelMap.set(squadName.toUpperCase(), roleId);
        }
    }

    // Sync members
    for (const memberRow of squadMembersData) {
        if (!memberRow || !memberRow[1] || !memberRow[2]) continue;
        const userId = memberRow[1];
        const squadName = memberRow[2].toUpperCase();
        const correctRoleId = squadLevelMap.get(squadName);
        if (!correctRoleId) continue;

        const member = allGuildMembers.get(userId);
        if (!member) continue;

        const didUpdate = await syncMemberLevelRole(member, correctRoleId);
        if (didUpdate) updated++;
    }

    // Sync leaders (they are squad members too)
    for (const leaderRow of squadLeadersData) {
        if (!leaderRow || !leaderRow[1] || !leaderRow[2]) continue;
        const userId = leaderRow[1];
        const squadName = leaderRow[2].toUpperCase();
        const correctRoleId = squadLevelMap.get(squadName);
        if (!correctRoleId) continue;

        const member = allGuildMembers.get(userId);
        if (!member) continue;

        const didUpdate = await syncMemberLevelRole(member, correctRoleId);
        if (didUpdate) updated++;
    }

    logger.info(`[Level Sync] Updated ${updated} role assignments.`);
}

/**
 * Assign the correct level role to a single user when they join a squad.
 */
async function assignLevelRoleOnJoin(guild, userId, squadName) {
    const sheets = await getSheetsClient();
    const squadWins = await calculateSquadWins(sheets);
    const data = squadWins.get(squadName);
    if (!data || data.squadType !== 'Competitive') return;

    const level = getSquadLevel(data.totalWins);
    const roleId = getLevelRole(level);
    if (!roleId) return;

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return;

    await member.roles.add(roleId).catch(e =>
        logger.error(`[Level Sync] Failed to add join role to ${userId}:`, e.message)
    );
}

/**
 * Strip all level roles from a user.
 */
async function stripLevelRoles(guild, userId) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return;

    for (const roleId of compSquadLevelRoles) {
        if (member.roles.cache.has(roleId)) {
            await member.roles.remove(roleId).catch(e =>
                logger.error(`[Level Sync] Failed to strip role from ${userId}:`, e.message)
            );
        }
    }
}

module.exports = {
    syncLevelRoles,
    assignLevelRoleOnJoin,
    stripLevelRoles,
    getSquadLevel,
    getLevelRole,
};
