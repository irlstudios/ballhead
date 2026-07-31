'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
    pickActiveSeason, seasonsToService, gamesNeedingRequests, assignmentsToRepair,
    requestsToComplete, requestsToCancel, requestsToClear,
    gamesEligibleForRequest, buildAutoDetails, parseScore, dashboardGameLink,
    projectRoster, rosterHash,
} = require('../utils/tourny_sync');

// Saves/restores TOURNY_DASHBOARD_URL around a test body, mirroring
// test/reengagement_job.test.js's env save/restore pattern.
function withDashboardUrl(value, fn) {
    const prev = process.env.TOURNY_DASHBOARD_URL;
    if (value === undefined) {
        delete process.env.TOURNY_DASHBOARD_URL;
    } else {
        process.env.TOURNY_DASHBOARD_URL = value;
    }
    try {
        fn();
    } finally {
        if (prev === undefined) delete process.env.TOURNY_DASHBOARD_URL;
        else process.env.TOURNY_DASHBOARD_URL = prev;
    }
}

test('pickActiveSeason prefers the newest open season', () => {
    const seasons = [
        { seasonId: 's1', status: 'complete', createdAt: 300 },
        { seasonId: 's2', status: 'regular', createdAt: 100 },
        { seasonId: 's3', status: 'playoffs', createdAt: 200 },
    ];
    assert.strictEqual(pickActiveSeason(seasons).seasonId, 's3');
    assert.strictEqual(pickActiveSeason([{ seasonId: 's1', status: 'complete', createdAt: 1 }]), null);
    assert.strictEqual(pickActiveSeason([]), null);
});

// --- seasonsToService -----------------------------------------------------

test('seasonsToService unions distinct request season ids with the active season', () => {
    const requests = [
        { tourny_season_id: 's1' },
        { tourny_season_id: 's2' },
        { tourny_season_id: 's1' }, // duplicate, collapses
        { tourny_season_id: null }, // ignored
        {}, // absent, ignored
    ];
    assert.deepStrictEqual([...seasonsToService(requests, 's3')].sort(), ['s1', 's2', 's3']);
});

test('seasonsToService returns only the request season ids when there is no active season', () => {
    const requests = [{ tourny_season_id: 's2' }, { tourny_season_id: 's1' }];
    assert.deepStrictEqual([...seasonsToService(requests, null)].sort(), ['s1', 's2']);
});

test('seasonsToService returns just the request season ids when they are the only source', () => {
    const requests = [{ tourny_season_id: 's1' }, { tourny_season_id: 's1' }];
    assert.deepStrictEqual([...seasonsToService(requests, 's1')].sort(), ['s1']);
});

test('seasonsToService returns an empty array for empty requests and no active season', () => {
    assert.deepStrictEqual(seasonsToService([], null), []);
    assert.deepStrictEqual(seasonsToService(null, null), []);
});

test('gamesNeedingRequests wants marked, unassigned, unlinked, not-yet-final games', () => {
    const games = [
        { gameId: 'g1', officialRequested: true },
        { gameId: 'g2', officialRequested: true, officialId: 'u9' },
        { gameId: 'g3', officialRequested: true },
        { gameId: 'g4' },
        { gameId: 'g5', officialRequested: true, status: 'final' },
    ];
    const linked = [{ tourny_game_id: 'g3' }];
    assert.deepStrictEqual(gamesNeedingRequests(games, linked).map((g) => g.gameId), ['g1']);
});

test('assignmentsToRepair finds pushes tourny never saw', () => {
    const requests = [
        { id: 1, status: 'Assigned', assigned_official_id: 'u1', tourny_game_id: 'g1' },
        { id: 2, status: 'Assigned', assigned_official_id: 'u2', tourny_game_id: 'g2' },
        { id: 3, status: 'Pending', tourny_game_id: 'g3' },
    ];
    const gamesById = { g1: { officialId: '' }, g2: { officialId: 'u2' } };
    assert.deepStrictEqual(assignmentsToRepair(requests, gamesById).map((r) => r.id), [1]);
});

test('assignmentsToRepair excludes a mismatched official on a game already final in tourny', () => {
    const requests = [
        { id: 1, status: 'Assigned', assigned_official_id: 'u1', tourny_game_id: 'g1' },
        { id: 2, status: 'Assigned', assigned_official_id: 'u2', tourny_game_id: 'g2' },
    ];
    const gamesById = {
        g1: { officialId: '', status: 'final' },
        g2: { officialId: '', status: 'scheduled' },
    };
    assert.deepStrictEqual(assignmentsToRepair(requests, gamesById).map((r) => r.id), [2]);
});

test('requestsToComplete finds assigned requests whose game went final', () => {
    const requests = [
        { id: 1, status: 'Assigned', tourny_game_id: 'g1' },
        { id: 2, status: 'Assigned', tourny_game_id: 'g2' },
    ];
    const gamesById = { g1: { status: 'final' }, g2: { status: 'disputed' } };
    assert.deepStrictEqual(requestsToComplete(requests, gamesById).map((r) => r.id), [1]);
});

// --- requestsToCancel ---------------------------------------------------------

test('requestsToCancel finds pending requests whose game settled without an official', () => {
    const requests = [
        { id: 1, status: 'Pending', tourny_game_id: 'g1' },
        { id: 2, status: 'Pending', tourny_game_id: 'g2' },
        { id: 3, status: 'Assigned', tourny_game_id: 'g1' },
        { id: 4, status: 'Pending', tourny_game_id: 'g3' },
    ];
    const gamesById = { g1: { status: 'final' }, g2: { status: 'scheduled' } };
    assert.deepStrictEqual(requestsToCancel(requests, gamesById).map((r) => r.id), [1]);
});

test('requestsToCancel ignores requests with no matching game', () => {
    assert.deepStrictEqual(requestsToCancel([{ id: 1, status: 'Pending', tourny_game_id: 'ghost' }], {}), []);
    assert.deepStrictEqual(requestsToCancel([], { g1: { status: 'final' } }), []);
    assert.deepStrictEqual(requestsToCancel(null, { g1: { status: 'final' } }), []);
});

// --- requestsToClear -----------------------------------------------------------

test('requestsToClear finds a denied Pending request whose officialRequested flag never cleared', () => {
    const requests = [{ id: 1, status: 'Denied', tourny_game_id: 'g1', assigned_official_id: null }];
    const gamesById = { g1: { officialRequested: true, officialId: '' } };
    assert.deepStrictEqual(requestsToClear(requests, gamesById).map((r) => r.id), [1]);
});

test('requestsToClear finds a denied Assigned request whose revoked official is still assigned in tourny', () => {
    const requests = [{ id: 1, status: 'Denied', tourny_game_id: 'g1', assigned_official_id: 'u1' }];
    const gamesById = { g1: { officialRequested: false, officialId: 'u1' } };
    assert.deepStrictEqual(requestsToClear(requests, gamesById).map((r) => r.id), [1]);
});

test('requestsToClear is a no-op skip when tourny already shows the game cleared', () => {
    const requests = [{ id: 1, status: 'Denied', tourny_game_id: 'g1', assigned_official_id: 'u1' }];
    const gamesById = { g1: { officialRequested: false, officialId: 'u2' } };
    assert.deepStrictEqual(requestsToClear(requests, gamesById), []);
});

test('requestsToClear ignores requests with no matching game', () => {
    assert.deepStrictEqual(requestsToClear([{ id: 1, tourny_game_id: 'ghost', assigned_official_id: 'u1' }], {}), []);
    assert.deepStrictEqual(requestsToClear([], { g1: { officialRequested: true } }), []);
    assert.deepStrictEqual(requestsToClear(null, { g1: { officialRequested: true } }), []);
});

// --- gamesEligibleForRequest ---------------------------------------------------

test('gamesEligibleForRequest keeps only not-final, unassigned, unrequested games', () => {
    const games = [
        { gameId: 'g1', status: 'scheduled' },
        { gameId: 'g2', status: 'final' },
        { gameId: 'g3', status: 'scheduled', officialId: 'u1' },
        { gameId: 'g4', status: 'scheduled', officialRequested: true },
        { gameId: 'g5', status: 'disputed' },
    ];
    assert.deepStrictEqual(gamesEligibleForRequest(games).map((g) => g.gameId), ['g1', 'g5']);
});

test('gamesEligibleForRequest handles empty/missing input', () => {
    assert.deepStrictEqual(gamesEligibleForRequest([]), []);
    assert.deepStrictEqual(gamesEligibleForRequest(null), []);
    assert.deepStrictEqual(gamesEligibleForRequest(undefined), []);
});

test('buildAutoDetails names the fixture', () => {
    const game = { week: 3, homeTeamId: 'tA', awayTeamId: 'tB' };
    assert.strictEqual(buildAutoDetails(game, { tA: 'Alpha', tB: 'Beta' }), 'Week 3: Alpha vs Beta');
    assert.strictEqual(buildAutoDetails(game, {}), 'Week 3: tA vs tB');
});

test('parseScore accepts whole numbers in range and nothing else', () => {
    assert.strictEqual(parseScore('42'), 42);
    assert.strictEqual(parseScore(' 0 '), 0);
    assert.strictEqual(parseScore('9999'), 9999);
    for (const bad of ['', '-1', '10000', 'abc', '1.5', null, undefined]) {
        assert.strictEqual(parseScore(bad), null);
    }
});

// --- dashboardGameLink ----------------------------------------------------

test('dashboardGameLink builds a dashboard link for a linked request when the env is set', () => {
    withDashboardUrl('https://dash.example.com', () => {
        const request = { tourny_game_id: 'g1', tourny_guild_id: 'guild-1' };
        assert.strictEqual(dashboardGameLink(request), 'https://dash.example.com/servers/guild-1 (game g1)');
    });
});

test('dashboardGameLink is null for an unlinked request even when the env is set', () => {
    withDashboardUrl('https://dash.example.com', () => {
        assert.strictEqual(dashboardGameLink({}), null);
        assert.strictEqual(dashboardGameLink({ tourny_game_id: 'g1' }), null);
        assert.strictEqual(dashboardGameLink({ tourny_guild_id: 'guild-1' }), null);
    });
});

test('dashboardGameLink is null when TOURNY_DASHBOARD_URL is unset', () => {
    withDashboardUrl(undefined, () => {
        const request = { tourny_game_id: 'g1', tourny_guild_id: 'guild-1' };
        assert.strictEqual(dashboardGameLink(request), null);
    });
});

test('dashboardGameLink normalizes a trailing slash on the env URL', () => {
    withDashboardUrl('https://dash.example.com/', () => {
        const request = { tourny_game_id: 'g2', tourny_guild_id: 'guild-2' };
        assert.strictEqual(dashboardGameLink(request), 'https://dash.example.com/servers/guild-2 (game g2)');
    });
});

// --- projectRoster ---------------------------------------------------------

test('projectRoster maps ballhead roster rows to the wire shape', () => {
    const rows = [{ discord_id: '111', discord_name: 'Ref Bob', sport: 'Basketball' }];
    assert.deepStrictEqual(projectRoster(rows), [{ id: '111', name: 'Ref Bob', sport: 'Basketball' }]);
});

test('projectRoster falls back name to the id and sport to empty string', () => {
    const rows = [
        { discord_id: '222', discord_name: '', sport: null },
        { discord_id: '333', discord_name: null, sport: undefined },
        { discord_id: '444', discord_name: '   ', sport: 'Any' },
    ];
    assert.deepStrictEqual(projectRoster(rows), [
        { id: '222', name: '222', sport: '' },
        { id: '333', name: '333', sport: '' },
        { id: '444', name: '444', sport: 'Any' },
    ]);
});

test('projectRoster truncates name to 100 chars and sport to 60', () => {
    const rows = [{ discord_id: '555', discord_name: 'x'.repeat(150), sport: 'y'.repeat(90) }];
    const [projected] = projectRoster(rows);
    assert.strictEqual(projected.name.length, 100);
    assert.strictEqual(projected.sport.length, 60);
});

test('projectRoster caps at 200 entries', () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({ discord_id: String(i), discord_name: `n${i}`, sport: '' }));
    assert.strictEqual(projectRoster(rows).length, 200);
});

test('projectRoster handles empty/missing input', () => {
    assert.deepStrictEqual(projectRoster([]), []);
    assert.deepStrictEqual(projectRoster(null), []);
    assert.deepStrictEqual(projectRoster(undefined), []);
});

// --- rosterHash -------------------------------------------------------------

test('rosterHash is stable and order-insensitive for the same set', () => {
    const a = [{ id: '1', name: 'A', sport: 'X' }, { id: '2', name: 'B', sport: 'Y' }];
    const b = [{ id: '2', name: 'B', sport: 'Y' }, { id: '1', name: 'A', sport: 'X' }];
    assert.strictEqual(rosterHash(a), rosterHash(b));
});

test('rosterHash changes when roster content changes', () => {
    const a = [{ id: '1', name: 'A', sport: 'X' }];
    const b = [{ id: '1', name: 'A changed', sport: 'X' }];
    const c = [];
    assert.notStrictEqual(rosterHash(a), rosterHash(b));
    assert.notStrictEqual(rosterHash(a), rosterHash(c));
});

test('rosterHash does not mutate its input while sorting', () => {
    const officials = [{ id: '2', name: 'B', sport: 'Y' }, { id: '1', name: 'A', sport: 'X' }];
    rosterHash(officials);
    assert.strictEqual(officials[0].id, '2');
});
