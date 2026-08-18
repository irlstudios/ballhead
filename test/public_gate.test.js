'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { canGoPublic } = require('../utils/voice_moderation/public_gate');

test('passes when healthy with a free worker', () => {
    assert.deepStrictEqual(canGoPublic({ healthy: true, freeWorkers: 2 }), { ok: true, reason: null });
});

test('fails closed when the pc is unhealthy', () => {
    assert.deepStrictEqual(canGoPublic({ healthy: false, freeWorkers: 2 }), { ok: false, reason: 'unhealthy' });
});

test('fails when no capture worker is free, health notwithstanding', () => {
    assert.deepStrictEqual(canGoPublic({ healthy: true, freeWorkers: 0 }), { ok: false, reason: 'no-workers' });
});
