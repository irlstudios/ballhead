'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { createStore, recordPacket } = require('../utils/voice_moderation/buffers');
const { drainUserChunks } = require('../utils/voice_moderation/chunker');
const { wavToMonoPcm } = require('../utils/voice_moderation/wav');

// A fake decoded 20ms stereo frame: 960 samples * 2 channels * 2 bytes.
const stereoFrame = Buffer.alloc(960 * 4);
const fakeDecodeForUser = () => () => stereoFrame;

const fillStore = (store, userId, fromMs, packetCount) => {
    for (let i = 0; i < packetCount; i += 1) {
        recordPacket(store, userId, Buffer.from([i % 250]), fromMs + i * 20);
    }
};

test('drains one 16k wav per speaker with enough packets', () => {
    const store = createStore({ windowMs: 300000 });
    fillStore(store, 'talker', 1000, 50);
    fillStore(store, 'blip', 1000, 3);
    const chunks = drainUserChunks({
        store, decodeForUser: fakeDecodeForUser, sinceMs: 0, nowMs: 3000, minPackets: 25,
    });
    assert.deepStrictEqual([...chunks.keys()], ['talker']);
    const parsed = wavToMonoPcm(chunks.get('talker'));
    assert.strictEqual(parsed.sampleRate, 16000);
    assert.ok(parsed.pcm.length > 0);
});

test('only packets since sinceMs are included', () => {
    const store = createStore({ windowMs: 300000 });
    fillStore(store, 'talker', 0, 30);
    fillStore(store, 'talker', 10000, 30);
    const all = drainUserChunks({
        store, decodeForUser: fakeDecodeForUser, sinceMs: 0, nowMs: 11000, minPackets: 25,
    });
    const recent = drainUserChunks({
        store, decodeForUser: fakeDecodeForUser, sinceMs: 9000, nowMs: 11000, minPackets: 25,
    });
    assert.ok(recent.get('talker').length < all.get('talker').length);
});

test('users filter drains only the requested speaker', () => {
    const store = createStore({ windowMs: 300000 });
    fillStore(store, 'talker', 1000, 50);
    fillStore(store, 'other', 1000, 50);
    const chunks = drainUserChunks({
        store, decodeForUser: fakeDecodeForUser, sinceMs: 0, nowMs: 3000, minPackets: 25,
        users: ['talker'],
    });
    assert.deepStrictEqual([...chunks.keys()], ['talker']);
});

test('returns an empty map when nobody spoke', () => {
    const store = createStore({ windowMs: 300000 });
    const chunks = drainUserChunks({
        store, decodeForUser: fakeDecodeForUser, sinceMs: 0, nowMs: 1000, minPackets: 25,
    });
    assert.strictEqual(chunks.size, 0);
});
