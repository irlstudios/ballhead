'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { findLapsedMembers } = require('../programs/reengagement/churn/ff_churn');

// A roster entry as produced by the FF adapter from a season tab.
function member({ name, discordId, points = '0', mmr = '0' }) {
    return {
        inGameName: name,
        discordId: discordId || null,
        stats: { points, mmr, wins: '0', gamesPlayed: '0' },
    };
}

// Default: current season is 43. Prior-activity window is N-2..N-4 (41, 40, 39),
// recent window that must be empty is N and N-1 (43, 42).
function baseInput(overrides = {}) {
    return {
        currentSeason: 43,
        rostersBySeason: new Map(),
        idLookup: () => null,
        ...overrides,
    };
}

test('flags a member who played in N-2 and is absent from N and N-1', () => {
    const rostersBySeason = new Map([
        [41, [member({ name: 'TIMMY', discordId: '111', points: '500', mmr: '6000' })]],
        [42, []],
        [43, []],
    ]);
    const result = findLapsedMembers(baseInput({ rostersBySeason }));
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].userId, '111');
    assert.strictEqual(result[0].inGameName, 'TIMMY');
    assert.strictEqual(result[0].lastActiveSeason, 41);
    assert.deepStrictEqual(result[0].achievements.points, '500');
});

test('excludes a member active in the current season', () => {
    const rostersBySeason = new Map([
        [41, [member({ name: 'TIMMY', discordId: '111' })]],
        [43, [member({ name: 'TIMMY', discordId: '111' })]],
    ]);
    const result = findLapsedMembers(baseInput({ rostersBySeason }));
    assert.strictEqual(result.length, 0);
});

test('excludes a member active in the previous season (N-1)', () => {
    const rostersBySeason = new Map([
        [41, [member({ name: 'TIMMY', discordId: '111' })]],
        [42, [member({ name: 'TIMMY', discordId: '111' })]],
    ]);
    const result = findLapsedMembers(baseInput({ rostersBySeason }));
    assert.strictEqual(result.length, 0);
});

test('excludes a member whose only activity is too old (N-5)', () => {
    const rostersBySeason = new Map([
        [38, [member({ name: 'OLDY', discordId: '222' })]],
    ]);
    const result = findLapsedMembers(baseInput({ rostersBySeason }));
    assert.strictEqual(result.length, 0);
});

test('excludes a lapsed member with no resolvable Discord ID', () => {
    const rostersBySeason = new Map([
        [41, [member({ name: 'NO ID', discordId: null })]],
    ]);
    const result = findLapsedMembers(baseInput({ rostersBySeason }));
    assert.strictEqual(result.length, 0);
});

test('resolves Discord ID from the idLookup when the season row lacks one', () => {
    const rostersBySeason = new Map([
        [41, [member({ name: 'NO ID', discordId: null })]],
    ]);
    const idLookup = (name) => (name.toLowerCase() === 'no id' ? '333' : null);
    const result = findLapsedMembers(baseInput({ rostersBySeason, idLookup }));
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].userId, '333');
});

test('treats a name-only current-season row as active (matches by name)', () => {
    // Played S41 with an ID, appears in S43 under the same name without an ID.
    const rostersBySeason = new Map([
        [41, [member({ name: 'STAR MAX', discordId: '444' })]],
        [43, [member({ name: 'STAR MAX', discordId: null })]],
    ]);
    const result = findLapsedMembers(baseInput({ rostersBySeason }));
    assert.strictEqual(result.length, 0);
});

test('uses the most recent prior season for lastActiveSeason and achievements', () => {
    const rostersBySeason = new Map([
        [39, [member({ name: 'TIMMY', discordId: '111', points: '100' })]],
        [41, [member({ name: 'TIMMY', discordId: '111', points: '900' })]],
    ]);
    const result = findLapsedMembers(baseInput({ rostersBySeason }));
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].lastActiveSeason, 41);
    assert.strictEqual(result[0].achievements.points, '900');
});

test('does not double-count a member appearing in two prior seasons', () => {
    const rostersBySeason = new Map([
        [39, [member({ name: 'TIMMY', discordId: '111' })]],
        [40, [member({ name: 'TIMMY', discordId: '111' })]],
        [41, [member({ name: 'TIMMY', discordId: '111' })]],
    ]);
    const result = findLapsedMembers(baseInput({ rostersBySeason }));
    assert.strictEqual(result.length, 1);
});
