'use strict';

const { getSheetsClient, getCachedValues } = require('./sheets_cache');
const {
    SPREADSHEET_SQUADS,
    GYM_CLASS_GUILD_ID,
    LOGGING_CHANNEL_ID,
    TOP_COMP_SQUAD_ROLE_ID,
} = require('../config/constants');
const { getSquadTypeRoles, findMascotByName } = require('../config/squads');
const { withSquadLock } = require('./squad_lock');
const {
    findSquadMembers,
    isSameSquad,
    normalizeId,
    normalizeSquadName,
    resolveSquadType,
} = require('./squad_queries');
const logger = require('./logger');

const SQUAD_RANGES = [
    'Squad Members!A:E',
    'Squad Leaders!A:G',
    'All Data!A:H',
    'Applications!A:F',
];

function planSquadMembershipCleanup(squadLeaders, squadMembers, guildMemberIds) {
    const leaderGroups = new Map();

    for (const row of squadLeaders) {
        const ownerId = normalizeId(row?.[1]);
        const squadName = String(row?.[2] ?? '').trim();
        const squadKey = normalizeSquadName(squadName);
        if (!ownerId || !squadKey || squadKey === 'N/A') continue;

        const group = leaderGroups.get(squadKey) || {
            squadKey,
            squadName,
            ownerIds: new Set(),
        };
        group.ownerIds.add(ownerId);
        leaderGroups.set(squadKey, group);
    }

    const departedOwnerSquads = [...leaderGroups.values()]
        .filter(group => [...group.ownerIds].every(ownerId => !guildMemberIds.has(ownerId)))
        .map(group => ({
            squadKey: group.squadKey,
            squadName: group.squadName,
            ownerIds: [...group.ownerIds],
        }));
    const departedOwnerSquadKeys = new Set(departedOwnerSquads.map(group => group.squadKey));

    const departedMembersBySquad = new Map();
    for (const row of squadMembers) {
        const userId = normalizeId(row?.[1]);
        const squadName = String(row?.[2] ?? '').trim();
        const squadKey = normalizeSquadName(squadName);
        if (!userId || !squadKey || squadKey === 'N/A') continue;
        if (departedOwnerSquadKeys.has(squadKey) || guildMemberIds.has(userId)) continue;

        const group = departedMembersBySquad.get(squadKey) || {
            squadKey,
            squadName,
            members: new Map(),
        };
        if (!group.members.has(userId)) {
            group.members.set(userId, {
                userId,
                username: String(row?.[0] ?? userId),
            });
        }
        departedMembersBySquad.set(squadKey, group);
    }

    return {
        departedOwnerSquads,
        departedMembersBySquad: [...departedMembersBySquad.values()].map(group => ({
            squadKey: group.squadKey,
            squadName: group.squadName,
            members: [...group.members.values()],
        })),
    };
}

async function fetchFreshSquadData(sheets) {
    const response = await sheets.spreadsheets.values.batchGet({
        spreadsheetId: SPREADSHEET_SQUADS,
        ranges: SQUAD_RANGES,
    });
    const valueRanges = response.data.valueRanges || [];
    return {
        squadMembers: (valueRanges[0]?.values || []).slice(1),
        squadLeaders: (valueRanges[1]?.values || []).slice(1),
        allData: (valueRanges[2]?.values || []).slice(1),
        applications: (valueRanges[3]?.values || []).slice(1),
    };
}

async function clearSheetRanges(sheets, ranges) {
    if (ranges.length === 0) return;
    await sheets.spreadsheets.values.batchClear({
        spreadsheetId: SPREADSHEET_SQUADS,
        resource: { ranges },
    });
}

async function resetAllDataRows(sheets, rowNumbers) {
    if (rowNumbers.length === 0) return;
    await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_SQUADS,
        resource: {
            valueInputOption: 'RAW',
            data: rowNumbers.map(rowNumber => ({
                range: `All Data!C${rowNumber}:G${rowNumber}`,
                values: [['N/A', 'N/A', 'N/A', 'FALSE', 'No']],
            })),
        },
    });
}

async function pruneMembersFromSquad(sheets, squadName, departedMembers) {
    const departedById = new Map(departedMembers.map(member => [normalizeId(member.userId), member]));

    return withSquadLock(squadName, async () => {
        const fresh = await fetchFreshSquadData(sheets);
        const memberRowNumbers = [];
        const allDataRowNumbers = [];
        const removedIds = new Set();

        for (let index = 0; index < fresh.squadMembers.length; index += 1) {
            const row = fresh.squadMembers[index];
            const userId = normalizeId(row?.[1]);
            if (departedById.has(userId) && isSameSquad(row?.[2], squadName)) {
                memberRowNumbers.push(index + 2);
                removedIds.add(userId);
            }
        }
        for (let index = 0; index < fresh.allData.length; index += 1) {
            const row = fresh.allData[index];
            if (removedIds.has(normalizeId(row?.[1])) && isSameSquad(row?.[2], squadName)) {
                allDataRowNumbers.push(index + 2);
            }
        }

        await clearSheetRanges(
            sheets,
            memberRowNumbers.map(rowNumber => `Squad Members!A${rowNumber}:E${rowNumber}`)
        );
        await resetAllDataRows(sheets, allDataRowNumbers);

        return [...removedIds].map(userId => departedById.get(userId));
    });
}

async function cleanupDisbandedMember(member, squadName, roleIds) {
    await member.send(
        `The squad **${squadName}** was disbanded because its owner is no longer in the server.`
    ).catch(error => logger.info(`[Prune] Failed to DM ${member.id}: ${error.message}`));

    if (member.nickname && member.nickname.trim().toUpperCase().startsWith(`[${normalizeSquadName(squadName)}]`)) {
        await member.setNickname(member.user.username).catch(error => {
            if (error.code !== 50013) {
                logger.info(`[Prune] Failed to reset nickname for ${member.id}: ${error.message}`);
            }
        });
    }

    const assignedRoleIds = roleIds.filter(roleId => member.roles.cache.has(roleId));
    if (assignedRoleIds.length > 0) {
        await member.roles.remove(assignedRoleIds).catch(error => {
            if (error.code !== 50013 && error.code !== 10011) {
                logger.info(`[Prune] Failed to remove squad roles from ${member.id}: ${error.message}`);
            }
        });
    }
}

async function disbandDepartedOwnerSquad(sheets, squadName, guildMemberIds, allGuildMembers) {
    return withSquadLock(squadName, async () => {
        const fresh = await fetchFreshSquadData(sheets);
        const leaderRows = fresh.squadLeaders
            .map((row, index) => ({ row, rowNumber: index + 2 }))
            .filter(item => isSameSquad(item.row?.[2], squadName));

        if (leaderRows.length === 0) {
            return { disbanded: false, reason: 'already-removed', squadName };
        }

        const ownerIds = [...new Set(leaderRows.map(item => normalizeId(item.row?.[1])).filter(Boolean))];
        if (ownerIds.some(ownerId => guildMemberIds.has(ownerId))) {
            return { disbanded: false, reason: 'active-owner', squadName };
        }

        const memberRows = fresh.squadMembers
            .map((row, index) => ({ row, rowNumber: index + 2 }))
            .filter(item => isSameSquad(item.row?.[2], squadName));
        const allDataRows = fresh.allData
            .map((row, index) => ({ row, rowNumber: index + 2 }))
            .filter(item => isSameSquad(item.row?.[2], squadName));

        const typeResolution = resolveSquadType(fresh.allData, ownerIds[0], squadName, {
            applicationRows: fresh.applications,
        });
        const eventSquadName = leaderRows
            .map(item => String(item.row?.[3] ?? '').trim())
            .find(value => value && value !== 'N/A');
        const roleIds = [...getSquadTypeRoles(typeResolution.squadType)];
        if (typeResolution.squadType === 'Competitive') roleIds.push(TOP_COMP_SQUAD_ROLE_ID);
        const mascot = eventSquadName ? findMascotByName(eventSquadName) : null;
        if (mascot) roleIds.push(mascot.roleId);

        await clearSheetRanges(sheets, [
            ...memberRows.map(item => `Squad Members!A${item.rowNumber}:E${item.rowNumber}`),
            ...leaderRows.map(item => `Squad Leaders!A${item.rowNumber}:G${item.rowNumber}`),
        ]);
        await resetAllDataRows(sheets, allDataRows.map(item => item.rowNumber));

        const memberIds = [...new Set(memberRows.map(item => normalizeId(item.row?.[1])).filter(Boolean))];
        for (const memberId of memberIds) {
            const member = allGuildMembers.get(memberId);
            if (member) await cleanupDisbandedMember(member, squadName, roleIds);
        }

        return {
            disbanded: true,
            squadName,
            ownerIds,
            memberIds,
            squadType: typeResolution.squadType,
        };
    });
}

/**
 * Prune members who left the server from a specific squad.
 * Returns the removed member records.
 */
async function pruneSquad(sheets, _guild, guildMemberIds, squadName, squadMembersData, _allData) {
    const departedMembers = findSquadMembers(squadMembersData, squadName)
        .filter(row => {
            const userId = normalizeId(row?.[1]);
            return userId && !guildMemberIds.has(userId);
        })
        .map(row => ({
            userId: normalizeId(row[1]),
            username: String(row[0] ?? row[1]),
        }));

    if (departedMembers.length === 0) return [];
    return pruneMembersFromSquad(sheets, squadName, departedMembers);
}

/**
 * Nightly squad membership reconciliation.
 * Disbands squads whose owners left the guild, then prunes departed members.
 */
async function pruneInactiveMembers(client) {
    const sheets = await getSheetsClient();
    const guild = await client.guilds.fetch(GYM_CLASS_GUILD_ID);
    const allGuildMembers = await guild.members.fetch();
    const guildMemberIds = new Set(allGuildMembers.keys());

    const results = await getCachedValues({
        sheets,
        spreadsheetId: SPREADSHEET_SQUADS,
        ranges: SQUAD_RANGES,
        ttlMs: 30000,
    });
    const squadMembers = (results.get('Squad Members!A:E') || []).slice(1);
    const squadLeaders = (results.get('Squad Leaders!A:G') || []).slice(1);
    const cleanupPlan = planSquadMembershipCleanup(squadLeaders, squadMembers, guildMemberIds);

    const disbandedSquads = [];
    for (const squad of cleanupPlan.departedOwnerSquads) {
        try {
            const result = await disbandDepartedOwnerSquad(
                sheets,
                squad.squadName,
                guildMemberIds,
                allGuildMembers
            );
            if (result.disbanded) disbandedSquads.push(result);
        } catch (error) {
            logger.error(`[Prune] Failed to disband ${squad.squadName} after its owner left:`, error);
        }
    }

    const prunedBySquad = new Map();
    for (const squad of cleanupPlan.departedMembersBySquad) {
        try {
            const pruned = await pruneMembersFromSquad(sheets, squad.squadName, squad.members);
            if (pruned.length > 0) prunedBySquad.set(squad.squadName, pruned);
        } catch (error) {
            logger.error(`[Prune] Failed to prune members from ${squad.squadName}:`, error);
        }
    }

    for (const [squadName, pruned] of prunedBySquad) {
        const leader = squadLeaders.find(row => isSameSquad(row?.[2], squadName));
        const leaderMember = leader ? allGuildMembers.get(normalizeId(leader[1])) : null;
        if (!leaderMember) continue;

        const names = pruned.map(member => member.username).join(', ');
        await leaderMember.send(
            `The following members were removed from **${squadName}** because they left the server: ${names}`
        ).catch(error => logger.error(`[Prune] Failed to DM leader ${leader[1]}:`, error.message));
    }

    const totalPruned = [...prunedBySquad.values()].reduce((sum, members) => sum + members.length, 0);
    logger.info(
        `[Prune] Disbanded ${disbandedSquads.length} ownerless squads and removed ${totalPruned} departed members from ${prunedBySquad.size} squads.`
    );

    if (disbandedSquads.length > 0 || totalPruned > 0) {
        const loggingChannel = await guild.channels.fetch(LOGGING_CHANNEL_ID).catch(() => null);
        if (loggingChannel) {
            await loggingChannel.send(
                `Nightly squad cleanup: disbanded **${disbandedSquads.length}** ownerless squad(s) and removed **${totalPruned}** departed member(s).`
            ).catch(error => logger.error('[Prune] Failed to post cleanup summary:', error.message));
        }
    }

    return { disbandedSquads, prunedBySquad };
}

module.exports = {
    disbandDepartedOwnerSquad,
    planSquadMembershipCleanup,
    pruneSquad,
    pruneInactiveMembers,
};
