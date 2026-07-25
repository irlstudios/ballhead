'use strict';

const { getCachedValues } = require('./sheets_cache');
const {
    SPREADSHEET_SQUADS,
    AD_ID,
    SL_PARENT_SQUAD,
    SQUAD_LEADER_ROLE_ID,
    COMPETITIVE_SQUAD_OWNER_ROLE_ID,
} = require('../config/constants');

const AD_SQUAD_NAME = 2;
const AD_SQUAD_TYPE = 3;
const AD_IS_LEADER = 6;
const SL_ID = 1;
const SL_SQUAD_NAME = 2;
const SM_USERNAME = 0;
const SM_ID = 1;
const SM_SQUAD_NAME = 2;
const VALID_SQUAD_TYPES = new Set(['Casual', 'Competitive', 'Content']);

function normalizeId(value) {
    return String(value ?? '').trim();
}

function normalizeSquadName(value) {
    return String(value ?? '').trim().toUpperCase();
}

function parseDiscordUserId(value) {
    const normalizedValue = normalizeId(value);
    const match = normalizedValue.match(/^(?:<@!?(\d{17,20})>|(\d{17,20}))$/);
    return match ? match[1] || match[2] : null;
}

function isSameSquad(left, right) {
    const leftName = normalizeSquadName(left);
    return Boolean(leftName) && leftName === normalizeSquadName(right);
}

/**
 * Fetch all sheet data needed for squad operations.
 * Returns: { allData, squadLeaders, squadMembers } (headerless arrays)
 */
async function fetchSquadSheets(sheets) {
    const results = await getCachedValues({
        sheets,
        spreadsheetId: SPREADSHEET_SQUADS,
        ranges: ['All Data!A:H', 'Squad Leaders!A:G', 'Squad Members!A:E'],
        ttlMs: 30000,
    });
    const allData = (results.get('All Data!A:H') || []).slice(1);
    const squadLeaders = (results.get('Squad Leaders!A:G') || []).slice(1);
    const squadMembers = (results.get('Squad Members!A:E') || []).slice(1);
    return { allData, squadLeaders, squadMembers };
}

/**
 * Find all squads a user leads.
 * Returns array of leader rows (may be 0, 1, 2, or 3).
 */
function findUserSquads(squadLeaders, userId) {
    const normalizedUserId = normalizeId(userId);
    return squadLeaders.filter(
        row => row && row.length > SL_ID && normalizeId(row[SL_ID]) === normalizedUserId
    );
}

/**
 * Find a specific squad leader row by userId + squadName.
 */
function findLeaderRow(squadLeaders, userId, squadName) {
    const normalizedUserId = normalizeId(userId);
    return squadLeaders.find(
        row => row && row.length > SL_SQUAD_NAME
            && normalizeId(row[SL_ID]) === normalizedUserId
            && isSameSquad(row[SL_SQUAD_NAME], squadName)
    ) || null;
}

/**
 * Find all All Data rows for a user.
 */
function findUserAllDataRows(allData, userId) {
    const normalizedUserId = normalizeId(userId);
    return allData.filter(
        row => row && row.length > AD_ID && normalizeId(row[AD_ID]) === normalizedUserId
    );
}

/**
 * Find a specific All Data row by userId + squadName (composite lookup).
 */
function findAllDataRow(allData, userId, squadName) {
    const normalizedUserId = normalizeId(userId);
    return allData.find(
        row => row && row.length > AD_SQUAD_NAME
            && normalizeId(row[AD_ID]) === normalizedUserId
            && isSameSquad(row[AD_SQUAD_NAME], squadName)
    ) || null;
}

/**
 * Find index of a specific All Data row by userId + squadName.
 */
function findAllDataRowIndex(allData, userId, squadName) {
    const normalizedUserId = normalizeId(userId);
    return allData.findIndex(
        row => row && row.length > AD_SQUAD_NAME
            && normalizeId(row[AD_ID]) === normalizedUserId
            && isSameSquad(row[AD_SQUAD_NAME], squadName)
    );
}

/**
 * Find all members of a squad.
 */
function findSquadMembers(squadMembers, squadName) {
    return squadMembers.filter(
        row => row && row.length > SM_SQUAD_NAME
            && isSameSquad(row[SM_SQUAD_NAME], squadName)
    );
}

/**
 * Find a specific member row by userId + squadName.
 */
function findMemberRow(squadMembers, userId, squadName) {
    const index = findMemberRowIndex(squadMembers, userId, squadName);
    return index === -1 ? null : squadMembers[index];
}

/**
 * Find the index of a specific member row by userId + squadName.
 */
function findMemberRowIndex(squadMembers, userId, squadName) {
    const normalizedUserId = normalizeId(userId);
    return squadMembers.findIndex(
        row => row && row.length > SM_SQUAD_NAME
            && normalizeId(row[SM_ID]) === normalizedUserId
            && isSameSquad(row[SM_SQUAD_NAME], squadName)
    );
}

/**
 * Build Discord autocomplete choices from stored squad membership rows.
 * This intentionally does not depend on the user still being in the guild.
 */
function buildSquadMemberChoices(squadMembers, squadNames, focusedValue = '', limit = 25) {
    const allowedSquads = new Set(squadNames.map(normalizeSquadName).filter(Boolean));
    const focused = String(focusedValue ?? '').trim().toLowerCase();
    const seenUserIds = new Set();
    const choices = [];

    for (const row of squadMembers) {
        if (!row || row.length <= SM_SQUAD_NAME) continue;

        const userId = parseDiscordUserId(row[SM_ID]);
        const squadName = String(row[SM_SQUAD_NAME] ?? '').trim();
        const normalizedSquadName = normalizeSquadName(squadName);
        if (!userId || !allowedSquads.has(normalizedSquadName) || seenUserIds.has(userId)) continue;

        const username = String(row[SM_USERNAME] ?? '').trim() || `Discord user ${userId}`;
        const searchable = `${username} ${userId} ${squadName}`.toLowerCase();
        if (focused && !searchable.includes(focused)) continue;

        seenUserIds.add(userId);
        choices.push({
            name: `${username} — ${squadName}`.slice(0, 100),
            value: userId,
        });
        if (choices.length >= limit) break;
    }

    return choices;
}

/**
 * Check if a squad name is taken by a DIFFERENT user.
 * Same user can register the same name for a different type.
 */
function isSquadNameTaken(squadLeaders, squadName, userId) {
    const normalizedUserId = normalizeId(userId);
    return squadLeaders.some(
        row => row && row.length > SL_SQUAD_NAME
            && isSameSquad(row[SL_SQUAD_NAME], squadName)
            && normalizeId(row[SL_ID]) !== normalizedUserId
    );
}

/**
 * Find A/B team pair for a user.
 * Returns { aTeam: leaderRow|null, bTeam: leaderRow|null }
 */
function findABTeams(squadLeaders, userId) {
    const userSquads = findUserSquads(squadLeaders, userId);
    const bTeam = userSquads.find(
        row => row.length > SL_PARENT_SQUAD && row[SL_PARENT_SQUAD] && row[SL_PARENT_SQUAD] !== ''
    ) || null;
    const aTeamName = bTeam ? bTeam[SL_PARENT_SQUAD] : null;
    const aTeam = aTeamName
        ? userSquads.find(row => isSameSquad(row[SL_SQUAD_NAME], aTeamName)) || null
        : null;
    return { aTeam, bTeam };
}

function findUniqueUserSquads(squadLeaders, userId) {
    return [...new Map(
        findUserSquads(squadLeaders, userId)
            .map(row => [normalizeSquadName(row[SL_SQUAD_NAME]), row])
    ).values()];
}

/**
 * Disambiguate which squad a leader wants to operate on.
 * Returns { squad: leaderRow, error: string|null }
 */
function disambiguateSquad(squadLeaders, userId, specifiedSquadName) {
    const userSquads = findUniqueUserSquads(squadLeaders, userId);
    if (userSquads.length === 0) {
        return { squad: null, error: 'You do not own any squads.' };
    }
    if (userSquads.length === 1) {
        return { squad: userSquads[0], error: null };
    }
    if (!specifiedSquadName) {
        const squadList = userSquads.map(r => r[SL_SQUAD_NAME]).join(', ');
        return {
            squad: null,
            error: `You own multiple squads. Please specify which squad: ${squadList}`,
        };
    }
    const match = userSquads.find(
        row => isSameSquad(row[SL_SQUAD_NAME], specifiedSquadName)
    );
    if (!match) {
        return { squad: null, error: `You do not own a squad named "${specifiedSquadName}".` };
    }
    return { squad: match, error: null };
}

/**
 * Resolve the owned squad containing a stored member.
 * A squad name is only required when the member appears in multiple owned squads.
 */
function resolveOwnedSquadForMember(squadLeaders, squadMembers, ownerId, memberId, specifiedSquadName) {
    if (specifiedSquadName) {
        return disambiguateSquad(squadLeaders, ownerId, specifiedSquadName);
    }

    const ownedSquads = findUniqueUserSquads(squadLeaders, ownerId);
    if (ownedSquads.length === 0) {
        return { squad: null, error: 'You do not own any squads.' };
    }
    if (ownedSquads.length === 1) {
        return { squad: ownedSquads[0], error: null };
    }

    const matchingSquads = ownedSquads.filter(
        row => findMemberRowIndex(squadMembers, memberId, row[SL_SQUAD_NAME]) !== -1
    );
    if (matchingSquads.length === 1) {
        return { squad: matchingSquads[0], error: null };
    }
    if (matchingSquads.length === 0) {
        return { squad: null, error: 'That user is not a member of any squad you own.' };
    }

    const squadList = matchingSquads.map(row => row[SL_SQUAD_NAME]).join(', ');
    return {
        squad: null,
        error: `That user appears in multiple squads you own. Please specify which squad: ${squadList}`,
    };
}

/**
 * Resolve a squad type using the most specific reliable source available.
 * The Discord role fallback is needed for legacy/partially-written leader
 * records that have no matching row in All Data.
 */
function resolveSquadType(allData, userId, squadName, options = {}) {
    const normalizedUserId = normalizeId(userId);
    const matchingRows = allData.filter(
        row => row && row.length > AD_SQUAD_TYPE
            && normalizeId(row[AD_ID]) === normalizedUserId
            && isSameSquad(row[AD_SQUAD_NAME], squadName)
    );
    const exactTypes = [...new Set(matchingRows
        .map(row => String(row[AD_SQUAD_TYPE] ?? '').trim())
        .filter(type => VALID_SQUAD_TYPES.has(type)))];

    if (exactTypes.length === 1) {
        return { squadType: exactTypes[0], source: 'owner-row' };
    }
    if (exactTypes.length > 1) {
        return { squadType: null, source: 'conflicting-owner-rows' };
    }

    const squadTypes = [...new Set(allData
        .filter(row => row && row.length > AD_SQUAD_TYPE && isSameSquad(row[AD_SQUAD_NAME], squadName))
        .map(row => String(row[AD_SQUAD_TYPE] ?? '').trim())
        .filter(type => VALID_SQUAD_TYPES.has(type)))];

    if (squadTypes.length === 1) {
        return { squadType: squadTypes[0], source: 'squad-row' };
    }
    if (squadTypes.length > 1) {
        return { squadType: null, source: 'conflicting-squad-rows' };
    }

    const applicationTypes = [...new Set((options.applicationRows || [])
        .filter(row => row
            && normalizeId(row[1]) === normalizedUserId
            && isSameSquad(row[2], squadName)
            && String(row[5] ?? '').trim() === 'Accepted')
        .map(row => String(row[3] ?? '').trim())
        .filter(type => VALID_SQUAD_TYPES.has(type)))];
    if (applicationTypes.length === 1) {
        return { squadType: applicationTypes[0], source: 'accepted-application' };
    }
    if (applicationTypes.length > 1) {
        return { squadType: null, source: 'conflicting-applications' };
    }

    if (typeof options.hasCompetitiveOwnerRole === 'boolean') {
        return {
            squadType: options.hasCompetitiveOwnerRole ? 'Competitive' : 'Casual',
            source: 'owner-role',
        };
    }

    return { squadType: null, source: 'unresolved' };
}

/**
 * Determine which roles to remove after a squad operation.
 * Only removes roles the user no longer needs.
 * NOTE: Squad type is NOT in Squad Leaders (col D = Event Squad).
 * Must cross-reference All Data (col D = Squad Type) for type info.
 * @param {string} [excludeSquadName] - Squad name to exclude from "remaining" checks
 *   (the squad being disbanded/transferred, which may still appear in stale local arrays).
 */
function getRolesToRemove(allData, squadLeaders, userId, removedSquadType, excludeSquadName) {
    const allUserSquads = findUserSquads(squadLeaders, userId);
    const remainingSquads = excludeSquadName
        ? allUserSquads.filter(row => !isSameSquad(row[SL_SQUAD_NAME], excludeSquadName))
        : allUserSquads;
    const rolesToRemove = [];

    if (remainingSquads.length === 0) {
        rolesToRemove.push(SQUAD_LEADER_ROLE_ID);
    }

    const allUserRows = findUserAllDataRows(allData, userId);
    const remainingUserRows = excludeSquadName
        ? allUserRows.filter(row => row.length > AD_SQUAD_NAME && !isSameSquad(row[AD_SQUAD_NAME], excludeSquadName))
        : allUserRows;
    const hasCompSquad = remainingUserRows.some(
        row => row.length > AD_SQUAD_TYPE && row[AD_SQUAD_TYPE] === 'Competitive'
    );
    if (!hasCompSquad && removedSquadType === 'Competitive') {
        rolesToRemove.push(COMPETITIVE_SQUAD_OWNER_ROLE_ID);
    }

    return rolesToRemove;
}

module.exports = {
    fetchSquadSheets,
    findUserSquads,
    findLeaderRow,
    findUserAllDataRows,
    findAllDataRow,
    findAllDataRowIndex,
    findSquadMembers,
    findMemberRow,
    findMemberRowIndex,
    buildSquadMemberChoices,
    isSquadNameTaken,
    findABTeams,
    disambiguateSquad,
    resolveOwnedSquadForMember,
    resolveSquadType,
    getRolesToRemove,
    normalizeId,
    normalizeSquadName,
    parseDiscordUserId,
    isSameSquad,
    AD_SQUAD_NAME,
    AD_SQUAD_TYPE,
    AD_IS_LEADER,
    SL_ID,
    SL_SQUAD_NAME,
    SM_USERNAME,
    SM_ID,
    SM_SQUAD_NAME,
};
