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
const SM_ID = 1;
const SM_SQUAD_NAME = 2;

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
    return squadLeaders.filter(
        row => row && row.length > SL_ID && row[SL_ID] === userId
    );
}

/**
 * Find a specific squad leader row by userId + squadName.
 */
function findLeaderRow(squadLeaders, userId, squadName) {
    return squadLeaders.find(
        row => row && row.length > SL_SQUAD_NAME
            && row[SL_ID] === userId
            && row[SL_SQUAD_NAME]?.toUpperCase() === squadName?.toUpperCase()
    ) || null;
}

/**
 * Find all All Data rows for a user.
 */
function findUserAllDataRows(allData, userId) {
    return allData.filter(
        row => row && row.length > AD_ID && row[AD_ID] === userId
    );
}

/**
 * Find a specific All Data row by userId + squadName (composite lookup).
 */
function findAllDataRow(allData, userId, squadName) {
    return allData.find(
        row => row && row.length > AD_SQUAD_NAME
            && row[AD_ID] === userId
            && row[AD_SQUAD_NAME]?.toUpperCase() === squadName?.toUpperCase()
    ) || null;
}

/**
 * Find index of a specific All Data row by userId + squadName.
 */
function findAllDataRowIndex(allData, userId, squadName) {
    return allData.findIndex(
        row => row && row.length > AD_SQUAD_NAME
            && row[AD_ID] === userId
            && row[AD_SQUAD_NAME]?.toUpperCase() === squadName?.toUpperCase()
    );
}

/**
 * Find all members of a squad.
 */
function findSquadMembers(squadMembers, squadName) {
    return squadMembers.filter(
        row => row && row.length > SM_SQUAD_NAME
            && row[SM_SQUAD_NAME]?.toUpperCase() === squadName?.toUpperCase()
    );
}

/**
 * Find a specific member row by userId + squadName.
 */
function findMemberRow(squadMembers, userId, squadName) {
    return squadMembers.find(
        row => row && row.length > SM_SQUAD_NAME
            && row[SM_ID] === userId
            && row[SM_SQUAD_NAME]?.toUpperCase() === squadName?.toUpperCase()
    ) || null;
}

/**
 * Check if a squad name is taken by a DIFFERENT user.
 * Same user can register the same name for a different type.
 */
function isSquadNameTaken(squadLeaders, squadName, userId) {
    return squadLeaders.some(
        row => row && row.length > SL_SQUAD_NAME
            && row[SL_SQUAD_NAME]?.toUpperCase() === squadName?.toUpperCase()
            && row[SL_ID] !== userId
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
        ? userSquads.find(row => row[SL_SQUAD_NAME]?.toUpperCase() === aTeamName.toUpperCase()) || null
        : null;
    return { aTeam, bTeam };
}

/**
 * Disambiguate which squad a leader wants to operate on.
 * Returns { squad: leaderRow, error: string|null }
 */
function disambiguateSquad(squadLeaders, userId, specifiedSquadName) {
    const userSquads = findUserSquads(squadLeaders, userId);
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
        row => row[SL_SQUAD_NAME]?.toUpperCase() === specifiedSquadName.toUpperCase()
    );
    if (!match) {
        return { squad: null, error: `You do not own a squad named "${specifiedSquadName}".` };
    }
    return { squad: match, error: null };
}

/**
 * Determine which roles to remove after a squad operation.
 * Only removes roles the user no longer needs.
 * NOTE: Squad type is NOT in Squad Leaders (col D = Event Squad).
 * Must cross-reference All Data (col D = Squad Type) for type info.
 */
function getRolesToRemove(allData, squadLeaders, userId, removedSquadType) {
    const remainingSquads = findUserSquads(squadLeaders, userId);
    const rolesToRemove = [];

    if (remainingSquads.length === 0) {
        rolesToRemove.push(SQUAD_LEADER_ROLE_ID);
    }

    const remainingUserRows = findUserAllDataRows(allData, userId);
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
    isSquadNameTaken,
    findABTeams,
    disambiguateSquad,
    getRolesToRemove,
    AD_SQUAD_NAME,
    AD_SQUAD_TYPE,
    AD_IS_LEADER,
    SL_ID,
    SL_SQUAD_NAME,
    SM_ID,
    SM_SQUAD_NAME,
};
