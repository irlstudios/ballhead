'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { createStore, recordPacket } = require('../utils/voice_moderation/buffers');
const { drainUser } = require('../utils/voice_moderation/room_monitor');

const stereoFrame = Buffer.alloc(960 * 4);
const decodeForUser = () => () => stereoFrame;

const talkingStore = () => {
    const store = createStore({ windowMs: 300000 });
    for (let i = 0; i < 50; i += 1) recordPacket(store, 'u1', Buffer.from([1]), 1000 + i * 20);
    return store;
};

test('clean audio drains without flagging', async () => {
    const seen = [];
    const result = await drainUser({
        store: talkingStore(), decodeForUser, userId: 'u1', sinceMs: 0, nowMs: 5000,
        transcribe: async (wav) => { seen.push(wav.length); return { ok: true, text: 'all friendly here' }; },
        scan: () => ({ tier1: [], tier2: [] }),
        onFlag: async () => { throw new Error('must not flag'); },
    });
    assert.deepStrictEqual(result, { drained: true, ok: true, flagged: false });
    assert.strictEqual(seen.length, 1);
});

test('tier1 hit invokes onFlag with user, matches, and text', async () => {
    const flags = [];
    const result = await drainUser({
        store: talkingStore(), decodeForUser, userId: 'u1', sinceMs: 0, nowMs: 5000,
        transcribe: async () => ({ ok: true, text: 'go kys buddy' }),
        scan: () => ({ tier1: ['kys'], tier2: [] }),
        onFlag: async (flag) => { flags.push(flag); },
    });
    assert.deepStrictEqual(result, { drained: true, ok: true, flagged: true });
    assert.deepStrictEqual(flags[0], { userId: 'u1', matches: ['kys'], text: 'go kys buddy' });
});

test('transcription failure reports drained but not ok', async () => {
    const result = await drainUser({
        store: talkingStore(), decodeForUser, userId: 'u1', sinceMs: 0, nowMs: 5000,
        transcribe: async () => ({ ok: false, reason: 'http 500' }),
        scan: () => ({ tier1: [], tier2: [] }),
        onFlag: async () => {},
    });
    assert.deepStrictEqual(result, { drained: true, ok: false, flagged: false });
});

test('too little speech drains nothing and never transcribes', async () => {
    const store = createStore({ windowMs: 300000 });
    for (let i = 0; i < 5; i += 1) recordPacket(store, 'u1', Buffer.from([1]), 1000 + i * 20);
    const result = await drainUser({
        store, decodeForUser, userId: 'u1', sinceMs: 0, nowMs: 5000,
        transcribe: async () => { throw new Error('must not transcribe'); },
        scan: () => ({ tier1: [], tier2: [] }),
        onFlag: async () => {},
    });
    assert.deepStrictEqual(result, { drained: false, ok: true, flagged: false });
});

test('window respects sinceMs so audio is not scanned twice', async () => {
    const store = talkingStore();
    const result = await drainUser({
        store, decodeForUser, userId: 'u1', sinceMs: 4000, nowMs: 5000,
        transcribe: async () => { throw new Error('must not transcribe'); },
        scan: () => ({ tier1: [], tier2: [] }),
        onFlag: async () => {},
    });
    assert.deepStrictEqual(result, { drained: false, ok: true, flagged: false });
});
