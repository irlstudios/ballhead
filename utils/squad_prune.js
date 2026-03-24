'use strict';

const { getSheetsClient, getCachedValues } = require('./sheets_cache');
const {
    SPREADSHEET_SQUADS,
    BALLHEAD_GUILD_ID,
} = require('../config/constants');
const { withSquadLock } = require('./squad_lock');
const { findSquadMembers } = require('./squad_queries');
const logger = require('./logger');

/**
 * Prune members who left the server from a specific squad.
 * Returns array of pruned member IDs.
 */
async function pruneSquad(sheets, guild, guildMemberIds, squadName, squadMembersData, allData) {
    const members = findSquadMembers(squadMembersData, squadName);
    const pruned = [];

    for (const row of members) {
        const userId = row[1];
        if (!userId) continue;
        if (!guildMemberIds.has(userId)) {
            pruned.push({ userId, username: row[0] || userId });
        }
    }

    if (pruned.length === 0) return pruned;

    return withSquadLock(squadName, async () => {
        // Re-fetch to avoid stale data
        const freshResults = await getCachedValues({
            sheets,
            spreadsheetId: SPREADSHEET_SQUADS,
            ranges: ['Squad Members!A:E', 'All Data!A:H'],
            ttlMs: 5000,
        });
        const freshMembers = (freshResults.get('Squad Members!A:E') || []);
        const freshAllData = (freshResults.get('All Data!A:H') || []);

        const prunedIds = new Set(pruned.map(p => p.userId));

        // Clear individual Squad Members rows (targeted, no full-sheet rewrite)
        for (let i = 1; i < freshMembers.length; i++) {
            const row = freshMembers[i];
            if (row && row[1] && prunedIds.has(row[1]) && row[2]?.toUpperCase() === squadName.toUpperCase()) {
                const sheetRow = i + 1;
                await sheets.spreadsheets.values.clear({
                    spreadsheetId: SPREADSHEET_SQUADS,
                    range: `Squad Members!A${sheetRow}:E${sheetRow}`,
                });
            }
        }

        // Clear individual All Data rows (targeted, no full-sheet rewrite)
        for (let i = 1; i < freshAllData.length; i++) {
            const row = freshAllData[i];
            if (row && row[1] && prunedIds.has(row[1]) && row[2]?.toUpperCase() === squadName.toUpperCase()) {
                const sheetRow = i + 1;
                await sheets.spreadsheets.values.clear({
                    spreadsheetId: SPREADSHEET_SQUADS,
                    range: `All Data!A${sheetRow}:H${sheetRow}`,
                });
            }
        }

        return pruned;
    });
}

/**
 * Prune all squads. Used by daily cron.
 */
async function pruneInactiveMembers(client) {
    const sheets = await getSheetsClient();
    const guild = await client.guilds.fetch(BALLHEAD_GUILD_ID);

    // Bulk fetch all guild members
    const allGuildMembers = await guild.members.fetch();
    const guildMemberIds = new Set(allGuildMembers.keys());

    const results = await getCachedValues({
        sheets,
        spreadsheetId: SPREADSHEET_SQUADS,
        ranges: ['Squad Members!A:E', 'Squad Leaders!A:G', 'All Data!A:H'],
        ttlMs: 30000,
    });
    const squadMembersData = (results.get('Squad Members!A:E') || []).slice(1);
    const squadLeadersData = (results.get('Squad Leaders!A:G') || []).slice(1);
    const allData = (results.get('All Data!A:H') || []).slice(1);

    // Get unique squad names
    const squadNames = [...new Set(squadMembersData
        .filter(row => row && row[2])
        .map(row => row[2])
    )];

    const prunedBySquad = new Map();

    for (const squadName of squadNames) {
        const pruned = await pruneSquad(sheets, guild, guildMemberIds, squadName, squadMembersData, allData);
        if (pruned.length > 0) {
            prunedBySquad.set(squadName, pruned);
        }
    }

    // DM squad leaders about pruned members
    for (const [squadName, pruned] of prunedBySquad) {
        const leader = squadLeadersData.find(
            r => r && r.length > 2 && r[2]?.toUpperCase() === squadName.toUpperCase()
        );
        if (!leader || !leader[1]) continue;

        const leaderMember = allGuildMembers.get(leader[1]);
        if (!leaderMember) continue;

        const names = pruned.map(p => p.username).join(', ');
        await leaderMember.send(
            `The following members were removed from **${squadName}** because they left the server: ${names}`
        ).catch(e => logger.error(`[Prune] Failed to DM leader ${leader[1]}:`, e.message));
    }

    const totalPruned = [...prunedBySquad.values()].reduce((sum, arr) => sum + arr.length, 0);
    logger.info(`[Prune] Removed ${totalPruned} inactive members from ${prunedBySquad.size} squads.`);
}

module.exports = {
    pruneSquad,
    pruneInactiveMembers,
};
