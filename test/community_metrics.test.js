'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { hasRowForRangeEnd } = require('../jobs/community-metrics');

// "Range End" is column C (index 2) of the Data tab.
const HEADER = ['Generated At', 'Range Start', 'Range End'];

test('hasRowForRangeEnd is false when no existing row matches the range end', () => {
    const rows = [HEADER, ['2026-05-29 20:01', '2026-05-22 20:01', '2026-05-29 20:01']];
    assert.strictEqual(hasRowForRangeEnd(rows, '2026-06-01 09:00'), false);
});

test('hasRowForRangeEnd is true when an existing row already has the range end', () => {
    const rows = [HEADER, ['2026-06-01 09:00', '2026-05-25 09:00', '2026-06-01 09:00']];
    assert.strictEqual(hasRowForRangeEnd(rows, '2026-06-01 09:00'), true);
});

test('hasRowForRangeEnd does not match the header row for a real timestamp', () => {
    assert.strictEqual(hasRowForRangeEnd([HEADER], '2026-06-01 09:00'), false);
});

test('hasRowForRangeEnd returns false for empty, missing, or blank input', () => {
    assert.strictEqual(hasRowForRangeEnd([], '2026-06-01 09:00'), false);
    assert.strictEqual(hasRowForRangeEnd(undefined, '2026-06-01 09:00'), false);
    assert.strictEqual(hasRowForRangeEnd([HEADER], ''), false);
    assert.strictEqual(hasRowForRangeEnd([HEADER], null), false);
});

test('hasRowForRangeEnd tolerates short or ragged rows', () => {
    const rows = [['onlyGeneratedAt'], ['a', 'b'], ['a', 'b', '2026-06-01 09:00']];
    assert.strictEqual(hasRowForRangeEnd(rows, '2026-06-01 09:00'), true);
});
