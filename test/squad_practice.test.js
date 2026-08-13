'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { parseDuration, buildRsvpCardLines, MAX_SCHEDULE_MS, MIN_SCHEDULE_MS } = require('../commands/squads/squad_practice');

test('parseDuration reads h/m/d combos and rejects garbage and out-of-range values', () => {
    assert.strictEqual(parseDuration('45m'), 45 * 60 * 1000);
    assert.strictEqual(parseDuration('2h'), 2 * 60 * 60 * 1000);
    assert.strictEqual(parseDuration('1h30m'), 90 * 60 * 1000);
    assert.strictEqual(parseDuration('1d'), 24 * 60 * 60 * 1000);
    assert.strictEqual(parseDuration('soon'), null);
    assert.strictEqual(parseDuration(''), null);
    assert.strictEqual(parseDuration('0m'), null);          // below minimum
    assert.strictEqual(parseDuration('30d'), null);         // above maximum
    assert.ok(MIN_SCHEDULE_MS <= parseDuration('10m'));
    assert.ok(parseDuration('14d') <= MAX_SCHEDULE_MS);
});

test('rsvp card shows the time, counts, and names', () => {
    const lines = buildRsvpCardLines(
        { id: 3, scheduled_at: new Date('2026-08-14T18:00:00Z') },
        [{ user_id: '1' }, { user_id: '2' }],
        [{ user_id: '3' }]
    );
    const text = lines.join('\n');
    assert.match(text, /<t:\d+:F>/);
    assert.match(text, /Yes \(2\)/);
    assert.match(text, /No \(1\)/);
    assert.match(text, /<@1>/);
});
