'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { completedCycle, cycleLabel, announcementText } = require('../utils/event_winner_cycle');
const { staleHolderIds } = require('../jobs/event-winner-cycle');

const ANCHOR = '2026-09-21';

test('no cycle has closed until a full 14 days have passed', () => {
    assert.strictEqual(completedCycle('2026-09-21', ANCHOR), null);
    assert.strictEqual(completedCycle('2026-10-04', ANCHOR), null);
    assert.strictEqual(completedCycle('2026-09-01', ANCHOR), null);
});

test('the closed cycle is the 14 days before the current one, end exclusive', () => {
    assert.deepStrictEqual(completedCycle('2026-10-05', ANCHOR), { start: '2026-09-21', end: '2026-10-05' });
    assert.deepStrictEqual(completedCycle('2026-10-19', ANCHOR), { start: '2026-10-05', end: '2026-10-19' });
});

// The whole point of anchoring: a job that misses its day announces the same
// cycle late rather than a window shifted by however long the bot was down.
test('a late run still resolves the cycle that closed, not a shifted one', () => {
    const onTime = completedCycle('2026-10-05', ANCHOR);
    for (const late of ['2026-10-06', '2026-10-11', '2026-10-18']) {
        assert.deepStrictEqual(completedCycle(late, ANCHOR), onTime, `late run on ${late}`);
    }
});

test('the label names the last day inside the window, not the exclusive end', () => {
    assert.strictEqual(cycleLabel({ start: '2026-09-21', end: '2026-10-05' }), '2026-09-21 to 2026-10-04');
});

test('a malformed anchor or date yields no cycle rather than a bogus window', () => {
    assert.strictEqual(completedCycle('not-a-date', ANCHOR), null);
    assert.strictEqual(completedCycle('2026-10-05', 'nonsense'), null);
});

test('the announcement names the champion, their wins and the role', () => {
    const text = announcementText({
        cycle: { start: '2026-09-21', end: '2026-10-05' },
        roleId: '555',
        standings: [
            { userId: '111', wins: 3 },
            { userId: '222', wins: 1 },
        ],
    });
    assert.match(text, /<@111>/);
    assert.match(text, /3 event wins/);
    assert.match(text, /<@&555>/);
    assert.match(text, /\*\*1st:\*\* <@111> - 3 wins/);
    assert.match(text, /\*\*2nd:\*\* <@222> - 1 win$/m);
    assert.doesNotMatch(text, /Tied on wins/);
});

test('the announcement drops the role line when no role is configured', () => {
    const text = announcementText({
        cycle: { start: '2026-09-21', end: '2026-10-05' },
        roleId: '',
        standings: [{ userId: '111', wins: 2 }],
    });
    assert.doesNotMatch(text, /<@&/);
    assert.match(text, /2 event wins/);
});

test('a tie on wins is called out so the tiebreak is not silent', () => {
    const text = announcementText({
        cycle: { start: '2026-09-21', end: '2026-10-05' },
        standings: [{ userId: '111', wins: 2 }, { userId: '222', wins: 2 }],
    });
    assert.match(text, /Tied on wins/);
});

test('an empty cycle produces no announcement at all', () => {
    assert.strictEqual(announcementText({ standings: [], cycle: { start: '2026-09-21', end: '2026-10-05' } }), null);
});

const fakeRole = (ids) => ({ members: { map: (fn) => ids.map((id) => fn({ id })) } });

test('the role is taken from every current holder except the new champion', () => {
    assert.deepStrictEqual(staleHolderIds(fakeRole(['old', 'handed-out-by-hand']), 'old', 'new').sort(),
        ['handed-out-by-hand', 'old']);
});

test('a champion who already holds the role is never stripped of it', () => {
    assert.deepStrictEqual(staleHolderIds(fakeRole(['champ']), 'champ', 'champ'), []);
});

// The cache can be cold after a restart, so the recorded holder is the floor.
test('the previous winner is swept even when the role cache is empty', () => {
    assert.deepStrictEqual(staleHolderIds(fakeRole([]), 'old', 'new'), ['old']);
});

// The spacers are what make the post readable in Discord; an over-eager filter
// on the conditional lines silently collapsed them once already.
test('the post keeps its blank lines between header, standings and footer', () => {
    const text = announcementText({
        cycle: { start: '2026-09-21', end: '2026-10-05' },
        roleId: '555',
        standings: [{ userId: '111', wins: 2 }],
    });
    assert.strictEqual(text.split('\n\n').length, 4, text);
});
