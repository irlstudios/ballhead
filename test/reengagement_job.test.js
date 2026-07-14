'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { resolveTargets } = require('../jobs/reengagement');

const makeAdapter = (calls) => ({
    id: 'ff',
    getLapsedMembers: async () => { calls.push('lapsed'); return [{ userId: 'L' }]; },
    getForcedTargets: async (ids) => { calls.push('forced'); return ids.map((id) => ({ userId: id })); },
});

test('non-force mode runs real churn detection', async () => {
    const calls = [];
    const targets = await resolveTargets(makeAdapter(calls), false);
    assert.deepStrictEqual(calls, ['lapsed']);
    assert.strictEqual(targets.length, 1);
});

test('force mode with no force ids yields no targets', async () => {
    const prev = process.env.REENGAGE_FORCE_USER_IDS;
    delete process.env.REENGAGE_FORCE_USER_IDS;
    const calls = [];
    const targets = await resolveTargets(makeAdapter(calls), true);
    assert.deepStrictEqual(targets, []);
    assert.ok(!calls.includes('forced'));
    if (prev !== undefined) process.env.REENGAGE_FORCE_USER_IDS = prev;
});

test('force mode injects the configured user ids as targets', async () => {
    const prev = process.env.REENGAGE_FORCE_USER_IDS;
    process.env.REENGAGE_FORCE_USER_IDS = '123,456';
    const calls = [];
    const targets = await resolveTargets(makeAdapter(calls), true);
    assert.deepStrictEqual(targets.map((t) => t.userId), ['123', '456']);
    assert.ok(calls.includes('forced'));
    if (prev === undefined) delete process.env.REENGAGE_FORCE_USER_IDS;
    else process.env.REENGAGE_FORCE_USER_IDS = prev;
});
