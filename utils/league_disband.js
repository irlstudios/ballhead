'use strict';

const {
    BASE_LEAGUE_ROLE_ID,
    ACTIVE_LEAGUE_ROLE_ID,
    SPONSORED_LEAGUE_ROLE_ID,
    LEAGUE_OWNER_ROLE_ID,
} = require('../config/constants');

const TIER_ROLE_BY_TYPE = Object.freeze({
    Base: BASE_LEAGUE_ROLE_ID,
    Active: ACTIVE_LEAGUE_ROLE_ID,
    Sponsored: SPONSORED_LEAGUE_ROLE_ID,
});

/**
 * Resolve the tier role id that corresponds to a league's type.
 * Returns null for unknown or missing types so callers can filter it out.
 */
function tierRoleIdForLeagueType(leagueType) {
    if (!leagueType) {
        return null;
    }
    return TIER_ROLE_BY_TYPE[leagueType] ?? null;
}

/**
 * Build an immutable teardown plan from a league record. Pure: performs no
 * Discord or database work, so it can be unit-tested without mocks.
 */
function buildDisbandPlan(league) {
    const tierRoleId = tierRoleIdForLeagueType(league.league_type);

    const ownerRolesToRemove = Object.freeze([LEAGUE_OWNER_ROLE_ID, tierRoleId].filter(Boolean));
    const coOwnerIds = Object.freeze([league.co_owner_1, league.co_owner_2].filter(Boolean));

    return Object.freeze({
        leagueId: league.league_id,
        leagueName: league.league_name,
        ownerId: league.owner_id,
        ownerRolesToRemove,
        coOwnerIds,
    });
}

module.exports = {
    tierRoleIdForLeagueType,
    buildDisbandPlan,
};
