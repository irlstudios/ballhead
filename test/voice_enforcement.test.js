'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { applyEnforcement, sendEnforcementNotice } = require('../utils/voice_moderation/enforcement');

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

const fakeClient = ({ sendFails = false, fetchFails = false } = {}) => {
    const sent = [];
    return {
        sent,
        users: {
            fetch: async () => {
                if (fetchFails) throw new Error('unknown user');
                return {
                    send: async (payload) => {
                        if (sendFails) throw new Error('cannot send messages to this user');
                        sent.push(payload);
                    },
                };
            },
        },
    };
};

test('notice DM tells a muted and blacklisted user both outcomes', async () => {
    const client = fakeClient();
    const result = await sendEnforcementNotice({
        client, userId: 'u1',
        actions: ['server muted', 'vc blacklist role applied'],
        transcript: 'the flagged sentence',
        clipWav: Buffer.from('wav'),
    });
    assert.strictEqual(result.sent, true);
    assert.strictEqual(client.sent.length, 1);
    const body = JSON.stringify(client.sent[0].components);
    assert.match(body, /muted in voice/);
    assert.match(body, /public voice rooms has been suspended/);
    assert.match(body, /the flagged sentence/);
    assert.strictEqual(client.sent[0].files.length, 1);
});

test('notice DM for mute only omits the blacklist line', async () => {
    const client = fakeClient();
    const result = await sendEnforcementNotice({
        client, userId: 'u1', actions: ['server muted'], transcript: 'words',
    });
    assert.strictEqual(result.sent, true);
    const body = JSON.stringify(client.sent[0].components);
    assert.match(body, /muted in voice/);
    assert.doesNotMatch(body, /suspended/);
});

test('no successful action means no DM', async () => {
    const client = fakeClient();
    const result = await sendEnforcementNotice({
        client, userId: 'u1', actions: [], transcript: 'words',
    });
    assert.strictEqual(result.sent, false);
    assert.match(result.reason, /no action/);
    assert.strictEqual(client.sent.length, 0);
});

test('closed DMs fail soft with the reason', async () => {
    const client = fakeClient({ sendFails: true });
    const result = await sendEnforcementNotice({
        client, userId: 'u1', actions: ['server muted'], transcript: 'words',
    });
    assert.strictEqual(result.sent, false);
    assert.match(result.reason, /cannot send/);
});
