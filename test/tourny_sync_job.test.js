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
    state.existingRequest = null;
    state.completeResult = null;
    state.denyResult = null;
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
    denyOfficialRequest: async (id, reason, deniedBy) => {
        calls.push(['denyOfficialRequest', id, reason, deniedBy]);
        return state.denyResult;
    },
});

installMock('../utils/tourny_client', {
    enabled: () => true,
    listSeasons: async () => ({ seasons: [{ seasonId: 's1', status: 'regular', createdAt: 1 }] }),
    listGames: async () => ({ games: state.games }),
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

// --- FIX 2: cancel-stale-pending sweep pass ------------------------------------

test('sweep cancels a Pending request whose game settled without an official', async () => {
    resetState();
    state.leagues = [league];
    state.games = [{ gameId: 'g1', status: 'final' }];
    state.linked = [{ id: 9, status: 'Pending', tourny_guild_id: 'guild-1', tourny_game_id: 'g1', tourny_season_id: 's1' }];
    state.denyResult = { id: 9, requested_by: 'req-9' };

    await runTournySync({});

    assert.deepStrictEqual(
        calls.find((c) => c[0] === 'denyOfficialRequest'),
        ['denyOfficialRequest', 9, 'Game was settled without an official', 'tourny-sync']
    );
    assert.ok(calls.some((c) => c[0] === 'updateOpsCard' && c[1] === 9));
    assert.ok(calls.some((c) => c[0] === 'dmUser' && c[1] === 'req-9' && c[2] === 'Official Request Cancelled'));
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
