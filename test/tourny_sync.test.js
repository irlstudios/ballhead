'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
    pickActiveSeason, gamesNeedingRequests, assignmentsToRepair,
    requestsToComplete, buildAutoDetails, parseScore,
} = require('../utils/tourny_sync');

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

test('requestsToComplete finds assigned requests whose game went final', () => {
    const requests = [
        { id: 1, status: 'Assigned', tourny_game_id: 'g1' },
        { id: 2, status: 'Assigned', tourny_game_id: 'g2' },
    ];
    const gamesById = { g1: { status: 'final' }, g2: { status: 'disputed' } };
    assert.deepStrictEqual(requestsToComplete(requests, gamesById).map((r) => r.id), [1]);
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
