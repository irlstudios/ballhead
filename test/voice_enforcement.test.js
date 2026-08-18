'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { applyEnforcement } = require('../utils/voice_moderation/enforcement');

const fakeGuild = ({ inVoice = true, muteFails = false, roleFails = false, found = true } = {}) => ({
    members: {
        fetch: async () => {
            if (!found) throw new Error('unknown member');
            return {
                voice: inVoice ? {
                    channel: { id: 'vc' },
                    setMute: async () => { if (muteFails) throw new Error('missing permissions'); },
                } : { channel: null },
                roles: {
                    add: async () => { if (roleFails) throw new Error('role above bot'); },
                },
            };
        },
    },
});

test('mutes and blacklists a member in voice', async () => {
    const result = await applyEnforcement({ guild: fakeGuild(), userId: 'u1', reason: 'test' });
    assert.deepStrictEqual(result.actions, ['server muted', 'vc blacklist role applied']);
    assert.deepStrictEqual(result.failures, []);
});

test('member out of voice still gets blacklisted, mute skipped', async () => {
    const result = await applyEnforcement({ guild: fakeGuild({ inVoice: false }), userId: 'u1', reason: 'test' });
    assert.deepStrictEqual(result.actions, ['vc blacklist role applied']);
    assert.deepStrictEqual(result.failures, ['not in voice, mute skipped']);
});

test('individual failures are reported, not thrown', async () => {
    const result = await applyEnforcement({
        guild: fakeGuild({ muteFails: true, roleFails: true }), userId: 'u1', reason: 'test',
    });
    assert.deepStrictEqual(result.actions, []);
    assert.strictEqual(result.failures.length, 2);
    assert.match(result.failures[0], /mute failed/);
    assert.match(result.failures[1], /blacklist failed/);
});

test('unknown member reports cleanly', async () => {
    const result = await applyEnforcement({ guild: fakeGuild({ found: false }), userId: 'u1', reason: 'test' });
    assert.deepStrictEqual(result, { actions: [], failures: ['member not found in guild'] });
});
