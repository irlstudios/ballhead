'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { buildStatusLines, PROGRAMS } = require('../commands/general_applications/apply_status');

test('buildStatusLines lists each pending application with relative time', () => {
    const submittedAt = new Date('2026-08-17T22:00:00Z');
    const lines = buildStatusLines([
        { name: 'Community Design Team', state: 'pending', submittedAt },
        { name: 'Official', state: 'pending', submittedAt: null },
    ]);
    assert.strictEqual(lines[0], `**Community Design Team**: pending review — submitted <t:${Math.floor(submittedAt.getTime() / 1000)}:R>`);
    assert.strictEqual(lines[1], '**Official**: pending review');
    assert.ok(lines[lines.length - 1].includes('DM'));
});

test('buildStatusLines reports lookup failures instead of hiding them', () => {
    const lines = buildStatusLines([
        { name: 'Official', state: 'pending', submittedAt: null },
        { name: 'Community Design Team', state: 'unavailable' },
    ]);
    assert.ok(lines.some((l) => l.includes('**Community Design Team**') && l.includes('could not be checked')));
    assert.ok(lines.some((l) => l.includes('**Official**: pending review')));
});

test('buildStatusLines explains the empty state without promising a DM arrived', () => {
    const lines = buildStatusLines([]);
    assert.ok(lines[0].includes('no applications'));
    assert.ok(lines.some((l) => l.includes('/apply')));
    assert.ok(!lines.join(' ').includes('was sent'), 'must not claim a DM was delivered');
});

test('every program has a name and a finder', () => {
    assert.ok(PROGRAMS.length >= 5);
    for (const program of PROGRAMS) {
        assert.strictEqual(typeof program.name, 'string');
        assert.strictEqual(typeof program.find, 'function');
    }
});
