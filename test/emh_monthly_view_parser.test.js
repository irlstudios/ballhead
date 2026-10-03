'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { parseMonthlyView, usernameIdsFromRequirementCheck } = require('../utils/emh_monthly_view_parser');

const IDS = { host_a: '1', host_b: '2', host_c: '3' };
// September 2026 grid: row 3 starts Sun 8/30.
const grid = (week1, week2 = []) => [
    ['EMH Monthly Calendar - September 2026 (Central Time)'],
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    week1,
    week2,
];

test('cells map to dates by grid position and entries keep their hand-set status', () => {
    const { entries, flags } = parseMonthlyView(grid([
        '30\n2PM - host_a\n(Hosted)\n4PM - host_b\n(No-Show)',
    ]), { usernameIds: IDS });
    assert.deepStrictEqual(flags, []);
    assert.deepStrictEqual(entries.map((e) => [e.date, e.username, e.status, e.statusSource]), [
        ['2026-08-30', 'host_a', 'hosted', 'manual'],
        ['2026-08-30', 'host_b', 'no_show', 'manual'],
    ]);
    assert.strictEqual(entries[0].startsAt.toISOString(), '2026-08-30T19:00:00.000Z');
});

test('unambiguous noise is accepted: CR, run-together lines, no space after dash, doubled paren', () => {
    const { entries, flags } = parseMonthlyView(grid([
        '30\n5PM -host_a\r\n(Scheduled)                      8PM - host_b                     (No-Show))',
    ]), { usernameIds: IDS });
    assert.deepStrictEqual(flags, []);
    assert.deepStrictEqual(entries.map((e) => [e.username, e.status]), [['host_a', 'scheduled'], ['host_b', 'no_show']]);
});

test('past scheduled slots are left for the resolver; hand-set ones are locked', () => {
    const { entries } = parseMonthlyView(grid(['30\n2PM - host_a\n(Scheduled)']), { usernameIds: IDS });
    assert.strictEqual(entries[0].status, 'scheduled');
    assert.strictEqual(entries[0].statusSource, 'auto');
});

test('ambiguous lines are flagged and never guessed', () => {
    const { entries, flags } = parseMonthlyView(grid([
        '30\n11AM - host_a\n(Hosted)\n12AM - host_b\n(Scheduled)\n9:45 - host_c\n(Hosted)\n3PM - stranger\n(Hosted)\nsee notes',
    ]), { usernameIds: IDS });
    assert.deepStrictEqual(flags.map((f) => f.reason).sort(), ['no-ampm', 'out-of-order', 'unknown-user', 'unparsed']);
    assert.deepStrictEqual(entries.map((e) => e.username), ['host_a']);
});

test('a typed day number that disagrees with the grid position is flagged', () => {
    const { flags } = parseMonthlyView(grid(['29\n2PM - host_a\n(Hosted)']), { usernameIds: IDS });
    assert.deepStrictEqual(flags.map((f) => f.reason), ['day-mismatch']);
});

test('overrides resolve flagged lines, including a move to the next day, and can skip', () => {
    const { entries, flags } = parseMonthlyView(grid([
        '30\n11:30PM - host_a\n(Hosted)\n12PM - host_b\n(Hosted)\n9:45 - host_c\n(Hosted)\n11:45PM - stranger\n(Hosted)',
    ]), {
        usernameIds: IDS,
        overrides: {
            times: { '2026-08-30|12PM|host_b': '2026-08-31 12AM', '2026-08-30|9:45|host_c': '9:45PM' },
            usernames: { stranger: '4' },
        },
    });
    assert.deepStrictEqual(flags, []);
    const b = entries.find((e) => e.username === 'host_b');
    assert.strictEqual(b.startsAt.toISOString(), '2026-08-31T05:00:00.000Z');
    assert.strictEqual(entries.find((e) => e.username === 'stranger').hostId, '4');

    const skipped = parseMonthlyView(grid(['30\n9:45 - host_c\n(Hosted)']), {
        usernameIds: IDS, overrides: { skip: ['2026-08-30|9:45|host_c'] },
    });
    assert.deepStrictEqual([skipped.entries, skipped.flags], [[], []]);
});

test('imported lengths default to an hour but stop at the next slot so legacy data never overlaps', () => {
    const { entries } = parseMonthlyView(grid(['30\n3:30PM - host_a\n(Hosted)\n4PM - host_b\n(Hosted)\n6PM - host_c\n(Hosted)']), { usernameIds: IDS });
    const minutes = entries.map((e) => (e.endsAt - e.startsAt) / 60000);
    assert.deepStrictEqual(minutes, [30, 60, 60]);
});

test('numeric-only cells (no bookings) are fine', () => {
    const { entries, flags } = parseMonthlyView(grid(['30', 31, '1']), { usernameIds: IDS });
    assert.deepStrictEqual([entries, flags], [[], []]);
});

test('requirement check rows become a lowercase username to id map, skipping section headers', () => {
    const map = usernameIdsFromRequirementCheck([
        ['Discord Username', 'Discord ID', 'Week 1'],
        ['EMH Leads'],
        ['Host_A', '100000000000000001'],
        [],
        ['host_b', '100000000000000002'],
        ['host_c', 'not-an-id'],
    ]);
    assert.deepStrictEqual(map, { host_a: '100000000000000001', host_b: '100000000000000002' });
});
