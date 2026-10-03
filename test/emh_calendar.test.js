'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { monthGrid, dayCell, buildMonthRows, GRID_ROWS } = require('../utils/emh_calendar');

test('october 2026 is a 5-week grid from sun 9/27 to sat 10/31', () => {
    const grid = monthGrid(new Date('2026-10-15T17:00:00Z'));
    assert.strictEqual(grid.title, 'EMH Monthly Calendar - October 2026 (Central Time)');
    assert.strictEqual(grid.weeks.length, 5);
    assert.strictEqual(grid.weeks[0][0], '2026-09-27');
    assert.strictEqual(grid.weeks[4][6], '2026-10-31');
    assert.strictEqual(grid.startInstant.toISOString(), '2026-09-27T05:00:00.000Z');
    assert.strictEqual(grid.endInstant.toISOString(), '2026-11-01T05:00:00.000Z');
});

test('august 2026 needs 6 weeks because it starts on a saturday', () => {
    const grid = monthGrid(new Date('2026-08-10T17:00:00Z'));
    assert.strictEqual(grid.weeks.length, 6);
    assert.strictEqual(grid.weeks[0][6], '2026-08-01');
    assert.strictEqual(grid.weeks[5][6], '2026-09-05');
});

const booking = (iso, hostUsername, status, minutes = 60) => ({
    hostUsername,
    status,
    startsAt: new Date(iso),
    endsAt: new Date(new Date(iso).getTime() + minutes * 60000),
});

test('a day cell lists that day\'s bookings by time in the hand-typed format', () => {
    const cell = dayCell('2026-10-06', [
        booking('2026-10-07T00:00:00Z', 'host_b', 'scheduled'),
        booking('2026-10-06T22:00:00Z', 'host_a', 'hosted'),
        booking('2026-10-08T00:00:00Z', 'host_c', 'scheduled'),
    ], true);
    const text = cell.userEnteredValue.stringValue;
    assert.strictEqual(text, '6\n5PM - host_a\n(Hosted)\n7PM - host_b\n(Scheduled)');
    assert.deepStrictEqual(cell.textFormatRuns.map((run) => run.startIndex), [text.indexOf('5PM'), text.indexOf('7PM')]);
    assert.ok(cell.textFormatRuns[0].format.foregroundColorStyle.rgbColor.green > 0.4);
});

test('no-show and cancelled get their own labels', () => {
    const cell = dayCell('2026-10-06', [
        booking('2026-10-06T22:00:00Z', 'host_a', 'no_show'),
        booking('2026-10-06T23:00:00Z', 'host_b', 'cancelled'),
    ], true);
    assert.match(cell.userEnteredValue.stringValue, /\(No-Show\)\n.*\n\(Cancelled\)$/);
});

test('an empty day is just its number and days outside the month are greyed', () => {
    const inside = dayCell('2026-10-06', [], true);
    const outside = dayCell('2026-09-27', [], false);
    assert.strictEqual(inside.userEnteredValue.stringValue, '6');
    assert.deepStrictEqual(inside.textFormatRuns, []);
    assert.notDeepStrictEqual(inside.userEnteredFormat.backgroundColor, outside.userEnteredFormat.backgroundColor);
});

test('the rows payload always has 8 rows so a shorter month clears the old 6th week', () => {
    const rows = buildMonthRows(monthGrid(new Date('2026-10-15T17:00:00Z')), []);
    assert.strictEqual(rows.length, GRID_ROWS);
    assert.strictEqual(rows[0].values[0].userEnteredValue.stringValue, 'EMH Monthly Calendar - October 2026 (Central Time)');
    assert.strictEqual(rows[1].values.map((c) => c.userEnteredValue.stringValue).join(','), 'Sun,Mon,Tue,Wed,Thu,Fri,Sat');
    assert.strictEqual(rows[7].values[0].userEnteredValue.stringValue, '');
});
