'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
    tierRoleIdForLeagueType,
    buildDisbandPlan,
} = require('../utils/league_disband');
const {
    BASE_LEAGUE_ROLE_ID,
    ACTIVE_LEAGUE_ROLE_ID,
    SPONSORED_LEAGUE_ROLE_ID,
    LEAGUE_OWNER_ROLE_ID,
} = require('../config/constants');

// --- tierRoleIdForLeagueType -------------------------------------------------

test('maps each league type to its tier role id', () => {
    assert.strictEqual(tierRoleIdForLeagueType('Base'), BASE_LEAGUE_ROLE_ID);
    assert.strictEqual(tierRoleIdForLeagueType('Active'), ACTIVE_LEAGUE_ROLE_ID);
    assert.strictEqual(tierRoleIdForLeagueType('Sponsored'), SPONSORED_LEAGUE_ROLE_ID);
});

test('returns null for unknown or missing league types', () => {
    assert.strictEqual(tierRoleIdForLeagueType('Gold'), null);
    assert.strictEqual(tierRoleIdForLeagueType(''), null);
    assert.strictEqual(tierRoleIdForLeagueType(undefined), null);
    assert.strictEqual(tierRoleIdForLeagueType(null), null);
});

// --- buildDisbandPlan --------------------------------------------------------

const baseLeague = {
    league_id: 42,
    league_name: 'Sky Ballers',
    owner_id: 'owner-123',
    league_type: 'Active',
    co_owner_1: null,
    co_owner_2: null,
};

test('carries league identity onto the plan', () => {
    const plan = buildDisbandPlan(baseLeague);
    assert.strictEqual(plan.leagueId, 42);
    assert.strictEqual(plan.leagueName, 'Sky Ballers');
    assert.strictEqual(plan.ownerId, 'owner-123');
});

test('owner role removal includes the league owner role and the tier role', () => {
    const plan = buildDisbandPlan(baseLeague);
    assert.deepStrictEqual(
        plan.ownerRolesToRemove,
        [LEAGUE_OWNER_ROLE_ID, ACTIVE_LEAGUE_ROLE_ID]
    );
});

test('filters an unresolved tier role out of owner role removal', () => {
    const plan = buildDisbandPlan({ ...baseLeague, league_type: 'Mystery' });
    assert.deepStrictEqual(plan.ownerRolesToRemove, [LEAGUE_OWNER_ROLE_ID]);
});

test('collects no co-owners when both slots are empty', () => {
    const plan = buildDisbandPlan(baseLeague);
    assert.deepStrictEqual(plan.coOwnerIds, []);
});

test('collects a single co-owner', () => {
    const plan = buildDisbandPlan({ ...baseLeague, co_owner_1: 'co-1' });
    assert.deepStrictEqual(plan.coOwnerIds, ['co-1']);
});

test('collects both co-owners', () => {
    const plan = buildDisbandPlan({ ...baseLeague, co_owner_1: 'co-1', co_owner_2: 'co-2' });
    assert.deepStrictEqual(plan.coOwnerIds, ['co-1', 'co-2']);
});

test('skips a null first slot but keeps a populated second slot', () => {
    const plan = buildDisbandPlan({ ...baseLeague, co_owner_1: null, co_owner_2: 'co-2' });
    assert.deepStrictEqual(plan.coOwnerIds, ['co-2']);
});

test('does not mutate the input league object', () => {
    const input = { ...baseLeague, co_owner_1: 'co-1' };
    const snapshot = JSON.stringify(input);
    buildDisbandPlan(input);
    assert.strictEqual(JSON.stringify(input), snapshot);
});
