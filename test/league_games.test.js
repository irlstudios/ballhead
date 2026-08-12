'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
    MIN_PLAYERS_PER_GAME,
    MAX_PLAYERS_PER_GAME,
    parsePlayerIds,
    validateGameSubmission,
    buildWeeklyStatsLines,
    buildOverviewLines,
    chunkLines,
    buildGameReportingNudge,
} = require('../utils/league_games');

// --- parsePlayerIds ----------------------------------------------------------

test('parses mentions with and without nickname bang', () => {
    assert.deepStrictEqual(
        parsePlayerIds('<@111111111111111111> <@!222222222222222222>'),
        ['111111111111111111', '222222222222222222']
    );
});

test('parses bare snowflake ids mixed with mentions', () => {
    assert.deepStrictEqual(
        parsePlayerIds('<@111111111111111111> 333333333333333333'),
        ['111111111111111111', '333333333333333333']
    );
});

test('dedupes repeated players', () => {
    assert.deepStrictEqual(
        parsePlayerIds('<@111111111111111111> <@111111111111111111>'),
        ['111111111111111111']
    );
});

test('ignores junk text and short numbers', () => {
    assert.deepStrictEqual(parsePlayerIds('alice bob 12345 vs team two'), []);
    assert.deepStrictEqual(parsePlayerIds(''), []);
    assert.deepStrictEqual(parsePlayerIds(null), []);
});

// --- validateGameSubmission --------------------------------------------------

const league = Object.freeze({ league_id: 7, league_name: 'Sky Ballers' });
const ids = (n) => Array.from({ length: n }, (_, i) => String(100000000000000000 + i));

test('rejects when caller has no league', () => {
    const res = validateGameSubmission({ league: null, playerIds: ids(4) });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.code, 'NO_LEAGUE');
});

test('rejects too few players', () => {
    const res = validateGameSubmission({ league, playerIds: ids(MIN_PLAYERS_PER_GAME - 1) });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.code, 'TOO_FEW_PLAYERS');
});

test('rejects too many players', () => {
    const res = validateGameSubmission({ league, playerIds: ids(MAX_PLAYERS_PER_GAME + 1) });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.code, 'TOO_MANY_PLAYERS');
});

test('accepts a valid submission', () => {
    const res = validateGameSubmission({ league, playerIds: ids(4) });
    assert.strictEqual(res.ok, true);
});

// --- buildWeeklyStatsLines ---------------------------------------------------

test('formats weekly rows newest first with games and unique players', () => {
    const lines = buildWeeklyStatsLines([
        { week_start: new Date('2026-07-27T00:00:00Z'), games: 3, players: 12 },
        { week_start: new Date('2026-07-20T00:00:00Z'), games: 1, players: 5 },
    ]);
    assert.deepStrictEqual(lines, [
        '- Week of 2026-07-27: **3** games, **12** unique players',
        '- Week of 2026-07-20: **1** game, **5** unique players',
    ]);
});

test('weekly lines fall back when empty', () => {
    assert.deepStrictEqual(buildWeeklyStatsLines([]), ['No games recorded in the last 4 weeks.']);
});

// --- buildOverviewLines ------------------------------------------------------

test('formats overview rows with hashtag and weekly numbers', () => {
    const lines = buildOverviewLines([
        { league_name: 'Sky Ballers', league_hashtag: 'gcskyballers', games_7d: 3, players_7d: 12 },
        { league_name: 'Dodge Kings', league_hashtag: null, games_7d: 0, players_7d: 0 },
    ]);
    assert.deepStrictEqual(lines, [
        '- **Sky Ballers** (#gcskyballers) — 3 games, 12 unique players (last 7 days)',
        '- **Dodge Kings** (no hashtag) — 0 games, 0 unique players (last 7 days)',
    ]);
});

test('overview lines fall back when empty', () => {
    assert.deepStrictEqual(buildOverviewLines([]), ['No registered leagues found.']);
});

// --- chunkLines --------------------------------------------------------------

test('keeps short lists in a single chunk', () => {
    assert.deepStrictEqual(chunkLines(['a', 'b'], 100), [['a', 'b']]);
});

test('splits when joined length would exceed the cap', () => {
    const lines = ['aaaa', 'bbbb', 'cccc'];
    assert.deepStrictEqual(chunkLines(lines, 10), [['aaaa', 'bbbb'], ['cccc']]);
});

test('never emits an empty chunk and keeps oversized single lines', () => {
    assert.deepStrictEqual(chunkLines([], 10), []);
    assert.deepStrictEqual(chunkLines(['x'.repeat(50)], 10), [['x'.repeat(50)]]);
});

// --- buildGameReportingNudge -------------------------------------------------

test('buildGameReportingNudge is silent with no leagues', () => {
    assert.deepStrictEqual(buildGameReportingNudge([]), []);
    assert.deepStrictEqual(buildGameReportingNudge(), []);
});

test('buildGameReportingNudge always points at submit-game', () => {
    const lines = buildGameReportingNudge([{ league_type: 'Base' }]);
    assert.ok(lines.some((l) => l.includes('/league submit-game')));
    assert.ok(!lines.some((l) => l.includes('/league request-official')));
});

test('buildGameReportingNudge adds request-official for eligible tiers', () => {
    for (const tier of ['Active', 'Sponsored']) {
        const lines = buildGameReportingNudge([{ league_type: 'Base' }, { league_type: tier }]);
        assert.ok(lines.some((l) => l.includes('/league request-official')), `${tier} should see officials line`);
    }
});
