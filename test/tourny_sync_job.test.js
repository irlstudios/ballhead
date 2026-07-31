'use strict';

const test = require('node:test');
const assert = require('node:assert');

// Mocks db.js, utils/tourny_client.js, handlers/league-officials.js and
// utils/logger.js by swapping the module cache entry before jobs/tourny-sync
// is first required (mirrors test/squad_member_removal.test.js). This covers
// the sweep-level wiring that utils/tourny_sync.js's pure-function tests
// cannot reach: the overlap guard, the dedupe recheck, and how each pure
// decision gets turned into a db/tourny call.

function installMock(relativePath, mockExports) {
    const modulePath = require.resolve(relativePath);
    require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports: mockExports };
}

const calls = [];
const state = {};

function resetState() {
    calls.length = 0;
    state.leagues = [];
    state.linked = [];
    state.denied = [];
    state.games = [];
    // Per-season override for listGames. When unset, every season id resolves
    // to state.games (preserves the single-season fixtures below). When set,
    // it is the sole source: a season id with no entry returns no games.
    state.gamesBySeason = null;
    state.seasons = null;
    state.existingRequest = null;
    state.completeResult = null;
    state.cancelResult = null;
    state.leaguesGate = null;
    delete process.env.TOURNY_DASHBOARD_URL;
}
resetState();

installMock('../db', {
    fetchActiveLeagues: async () => {
        calls.push(['fetchActiveLeagues']);
        if (state.leaguesGate) await state.leaguesGate;
        return state.leagues;
    },
    fetchOpenLinkedRequests: async () => state.linked,
    fetchRecentDeniedLinkedRequests: async () => state.denied,
    fetchRequestByTournyGame: async (guildId, gameId) => {
        calls.push(['fetchRequestByTournyGame', guildId, gameId]);
        return state.existingRequest;
    },
    insertOfficialRequest: async (args) => {
        calls.push(['insertOfficialRequest', args]);
        return { id: 101, ...args };
    },
    setOfficialRequestOpsMessage: async () => {},
    deleteOfficialRequest: async () => {},
    completeOfficialRequestWithReport: async (id, officialId, report) => {
        calls.push(['completeOfficialRequestWithReport', id, officialId, report]);
        return state.completeResult;
    },
    cancelPendingOfficialRequest: async (id, reason, actor) => {
        calls.push(['cancelPendingOfficialRequest', id, reason, actor]);
        return state.cancelResult;
    },
});

installMock('../utils/tourny_client', {
    enabled: () => true,
    listSeasons: async () => ({ seasons: state.seasons || [{ seasonId: 's1', status: 'regular', createdAt: 1 }] }),
    listGames: async (guildId, seasonId) => {
        calls.push(['listGames', guildId, seasonId]);
        if (state.gamesBySeason) {
            return { games: state.gamesBySeason[seasonId] || [] };
        }
        return { games: state.games };
    },
    listTeams: async () => ({ teams: [] }),
    assignOfficial: async (...args) => { calls.push(['assignOfficial', ...args]); },
    clearOfficial: async (...args) => { calls.push(['clearOfficial', ...args]); },
    reportAsOfficial: async () => {},
});

installMock('../handlers/league-officials', {
    postOfficialRequestCard: async () => ({ id: 'msg1' }),
    updateOpsCard: async (client, request) => { calls.push(['updateOpsCard', request.id]); },
    dmUser: async (client, userId, { title }) => { calls.push(['dmUser', userId, title]); },
});

installMock('../utils/logger', {
    info: () => {},
    warn: (...args) => calls.push(['warn', args.join(' ')]),
    error: () => {},
});

const { runTournySync } = require('../jobs/tourny-sync');

const league = Object.freeze({ league_id: 7, server_id: 'guild-1', league_name: 'Sky Ballers', owner_id: 'owner-1' });

// --- FIX 4: overlap guard ----------------------------------------------------

test('runTournySync ignores a re-entrant call while a sweep is already in flight', async () => {
    resetState();
    let releaseGate;
    state.leaguesGate = new Promise((resolve) => { releaseGate = resolve; });

    const first = runTournySync({});
    const second = runTournySync({}); // starts while `first` is still awaiting fetchActiveLeagues
    releaseGate();
    await Promise.all([first, second]);

    assert.strictEqual(calls.filter((c) => c[0] === 'fetchActiveLeagues').length, 1);
    const warnLines = calls.filter((c) => c[0] === 'warn').map((c) => c[1]);
    assert.strictEqual(warnLines.length, 1);
    assert.match(warnLines[0], /still running/i);
});

// --- FIX 5: dedupe recheck ----------------------------------------------------

test('createLinkedRequest skips the insert when a linked request already exists for the game', async () => {
    resetState();
    state.leagues = [league];
    state.games = [{ gameId: 'g1', officialRequested: true, status: 'scheduled' }];
    state.existingRequest = { id: 55 };

    await runTournySync({});

    assert.deepStrictEqual(
        calls.find((c) => c[0] === 'fetchRequestByTournyGame'),
        ['fetchRequestByTournyGame', 'guild-1', 'g1']
    );
    assert.ok(!calls.some((c) => c[0] === 'insertOfficialRequest'));
});

// --- FIX 2: cancel-stale-pending sweep pass ------------------------------------

test('sweep cancels a Pending request whose game settled without an official', async () => {
    resetState();
    state.leagues = [league];
    state.games = [{ gameId: 'g1', status: 'final' }];
    state.linked = [{ id: 9, status: 'Pending', tourny_guild_id: 'guild-1', tourny_game_id: 'g1', tourny_season_id: 's1' }];
    state.cancelResult = { id: 9, requested_by: 'req-9' };

    await runTournySync({});

    assert.deepStrictEqual(
        calls.find((c) => c[0] === 'cancelPendingOfficialRequest'),
        ['cancelPendingOfficialRequest', 9, 'Game was settled without an official', 'tourny-sync']
    );
    assert.ok(calls.some((c) => c[0] === 'updateOpsCard' && c[1] === 9));
    assert.ok(calls.some((c) => c[0] === 'dmUser' && c[1] === 'req-9' && c[2] === 'Official Request Cancelled'));
});

test('sweep skips a request that was assigned between the snapshot and the cancel claim (RESIDUAL fix)', async () => {
    // The `mine` list passed into syncLeague is a snapshot taken once at the
    // start of the sweep. If staff assign this exact request mid-sweep (after
    // the snapshot, before this loop runs), cancelPendingOfficialRequest's
    // WHERE status = 'Pending' loses the race and returns null -- the sweep
    // must not deny a request that is now correctly Assigned, and must not
    // touch the ops card or DM anyone about a cancellation that didn't happen.
    resetState();
    state.leagues = [league];
    state.games = [{ gameId: 'g1', status: 'final' }];
    state.linked = [{ id: 9, status: 'Pending', tourny_guild_id: 'guild-1', tourny_game_id: 'g1', tourny_season_id: 's1' }];
    state.cancelResult = null; // simulates the row already being Assigned when the UPDATE runs

    await runTournySync({});

    assert.deepStrictEqual(
        calls.find((c) => c[0] === 'cancelPendingOfficialRequest'),
        ['cancelPendingOfficialRequest', 9, 'Game was settled without an official', 'tourny-sync']
    );
    assert.ok(!calls.some((c) => c[0] === 'updateOpsCard'));
    assert.ok(!calls.some((c) => c[0] === 'dmUser'));
});

// --- FIX 3: stale-denied clear sweep pass --------------------------------------

test('sweep repeats a missed clearOfficial push for a denied Pending request', async () => {
    resetState();
    state.leagues = [league];
    state.games = [{ gameId: 'g2', officialRequested: true, officialId: '', status: 'scheduled' }];
    state.denied = [{ id: 12, status: 'Denied', tourny_guild_id: 'guild-1', tourny_game_id: 'g2', tourny_season_id: 's1', assigned_official_id: null }];

    await runTournySync({});

    assert.deepStrictEqual(
        calls.find((c) => c[0] === 'clearOfficial'),
        ['clearOfficial', 'guild-1', 'g2', 's1']
    );
});

test('sweep is a no-op skip when tourny already shows the denied game cleared (idempotent)', async () => {
    resetState();
    state.leagues = [league];
    state.games = [{ gameId: 'g3', officialRequested: false, officialId: '', status: 'scheduled' }];
    state.denied = [{ id: 13, status: 'Denied', tourny_guild_id: 'guild-1', tourny_game_id: 'g3', tourny_season_id: 's1', assigned_official_id: null }];

    await runTournySync({});

    assert.ok(!calls.some((c) => c[0] === 'clearOfficial'));
});

// --- FIX 6: proofUrl fallback --------------------------------------------------

test('completion falls back to a sentinel proofUrl when TOURNY_DASHBOARD_URL is unset', async () => {
    resetState();
    state.leagues = [league];
    state.games = [{ gameId: 'g4', status: 'final', officialId: 'off-1' }];
    state.linked = [{ id: 20, status: 'Assigned', tourny_guild_id: 'guild-1', tourny_game_id: 'g4', tourny_season_id: 's1', assigned_official_id: 'off-1' }];
    state.completeResult = { id: 20, requested_by: 'req-20' };

    await runTournySync({});

    const [, , , report] = calls.find((c) => c[0] === 'completeOfficialRequestWithReport');
    assert.strictEqual(report.proofUrl, 'verified-in-tourny-dashboard');
});

test('completion builds a dashboard proofUrl when TOURNY_DASHBOARD_URL is set', async () => {
    resetState();
    process.env.TOURNY_DASHBOARD_URL = 'https://dash.example.com';
    state.leagues = [league];
    state.games = [{ gameId: 'g5', status: 'final', officialId: 'off-1' }];
    state.linked = [{ id: 21, status: 'Assigned', tourny_guild_id: 'guild-1', tourny_game_id: 'g5', tourny_season_id: 's1', assigned_official_id: 'off-1' }];
    state.completeResult = { id: 21, requested_by: 'req-21' };

    await runTournySync({});

    const [, , , report] = calls.find((c) => c[0] === 'completeOfficialRequestWithReport');
    assert.strictEqual(report.proofUrl, 'https://dash.example.com/servers/guild-1');
});

// --- sweep services linked requests even without an open season ---------------

test('a league with no active season still completes an open request whose game (in its own closed season) went final', async () => {
    resetState();
    state.leagues = [league];
    state.seasons = [{ seasonId: 's0', status: 'complete', createdAt: 1 }]; // no open season
    state.gamesBySeason = { s0: [{ gameId: 'g0', status: 'final', officialId: 'off-1' }] };
    state.linked = [{ id: 30, status: 'Assigned', tourny_guild_id: 'guild-1', tourny_game_id: 'g0', tourny_season_id: 's0', assigned_official_id: 'off-1' }];
    state.completeResult = { id: 30, requested_by: 'req-30' };

    await runTournySync({});

    assert.ok(calls.some((c) => c[0] === 'listGames' && c[1] === 'guild-1' && c[2] === 's0'));
    assert.deepStrictEqual(
        calls.find((c) => c[0] === 'completeOfficialRequestWithReport'),
        ['completeOfficialRequestWithReport', 30, 'off-1', {
            proofUrl: 'verified-in-tourny-dashboard',
            notes: 'Result verified in the tourny dashboard.',
        }]
    );
    assert.ok(calls.some((c) => c[0] === 'updateOpsCard' && c[1] === 30));
    assert.ok(!calls.some((c) => c[0] === 'insertOfficialRequest'));
});

test('a game marked officialRequested in a completed season does not spawn a new request', async () => {
    resetState();
    state.leagues = [league];
    state.seasons = [
        { seasonId: 's1', status: 'regular', createdAt: 2 }, // active
        { seasonId: 's0', status: 'complete', createdAt: 1 }, // closed, still referenced by a request below
    ];
    state.gamesBySeason = {
        s1: [], // active season has no games of its own
        s0: [
            { gameId: 'g0', officialRequested: true, status: 'scheduled' }, // must NOT spawn a request
            { gameId: 'gKeep', officialId: 'off-2', status: 'scheduled' },
        ],
    };
    // Pulls season s0 into the sweep even though it is not the active season.
    state.linked = [{ id: 40, status: 'Assigned', tourny_guild_id: 'guild-1', tourny_game_id: 'gKeep', tourny_season_id: 's0', assigned_official_id: 'off-2' }];

    await runTournySync({});

    assert.ok(calls.some((c) => c[0] === 'listGames' && c[2] === 's0'));
    assert.ok(!calls.some((c) => c[0] === 'insertOfficialRequest'));
    assert.ok(!calls.some((c) => c[0] === 'fetchRequestByTournyGame'));
});
