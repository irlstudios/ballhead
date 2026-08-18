'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { reportCooldownRemaining } = require('../handlers/voice_report');

test('first report has no cooldown', () => {
    assert.strictEqual(reportCooldownRemaining('u1', 1000, new Map(), 60000), 0);
});

test('repeat report inside the window reports remaining time', () => {
    const cooldowns = new Map([['u1', 10000]]);
    assert.strictEqual(reportCooldownRemaining('u1', 40000, cooldowns, 60000), 30000);
});

test('cooldown expires exactly at the window edge', () => {
    const cooldowns = new Map([['u1', 10000]]);
    assert.strictEqual(reportCooldownRemaining('u1', 70000, cooldowns, 60000), 0);
});
