'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { createStore, recordPacket } = require('../utils/voice_moderation/buffers');
const { buildClip } = require('../utils/voice_moderation/clipper');
const { canUseClip, isModerator } = require('../handlers/room_event_voice');
const { MODERATOR_ROLES } = require('../config/constants');

const stereoSilence = Buffer.alloc(48 * 4);

test('buildClip returns null when the window holds no audio', () => {
    const store = createStore({ windowMs: 300000 });
    assert.strictEqual(buildClip({
        store, decodeForUser: () => () => stereoSilence, durationSeconds: 60, now: 1000000,
    }), null);
});

test('buildClip reports the participants whose packets are in the window', () => {
    const store = createStore({ windowMs: 300000 });
    const now = 1000000;
    recordPacket(store, 'u1', Buffer.from([1]), now - 5000);
    recordPacket(store, 'u2', Buffer.from([2]), now - 400000);
    const clip = buildClip({
        store, decodeForUser: () => () => stereoSilence, durationSeconds: 60, now,
    });
    assert.deepStrictEqual(clip.participantIds, ['u1']);
    assert.strictEqual(clip.windowEndMs, now);
    assert.strictEqual(clip.windowStartMs, now - 60000);
    assert.strictEqual(clip.wav.toString('ascii', 0, 4), 'RIFF');
    assert.strictEqual(clip.wav.length, 44 + 60000 * 48 * 2);
});

test('the session host may clip, a stranger may not', () => {
    const session = { hostId: 'host1' };
    assert.strictEqual(canUseClip({ callerId: 'host1', callerRoleIds: [], session }), true);
    assert.strictEqual(canUseClip({ callerId: 'rando', callerRoleIds: ['other'], session }), false);
});

test('any moderator role may clip regardless of host', () => {
    const session = { hostId: 'host1' };
    assert.strictEqual(canUseClip({ callerId: 'mod1', callerRoleIds: [MODERATOR_ROLES[0]], session }), true);
    assert.strictEqual(isModerator([MODERATOR_ROLES[1]]), true);
    assert.strictEqual(isModerator(['not-a-mod-role']), false);
});
