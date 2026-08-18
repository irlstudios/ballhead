'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { createStore, recordPacket } = require('../utils/voice_moderation/buffers');
const { runCycle } = require('../utils/voice_moderation/room_monitor');

const stereoFrame = Buffer.alloc(960 * 4);
const decodeForUser = () => () => stereoFrame;

const talkingStore = () => {
    const store = createStore({ windowMs: 300000 });
    for (let i = 0; i < 50; i += 1) recordPacket(store, 'u1', Buffer.from([1]), 1000 + i * 20);
    return store;
};

test('transcribes each speaker chunk and reports no flags on clean audio', async () => {
    const seen = [];
    const result = await runCycle({
        store: talkingStore(), decodeForUser, sinceMs: 0, nowMs: 5000,
        transcribe: async (wav) => { seen.push(wav.length); return { ok: true, text: 'all friendly here' }; },
        scan: () => ({ tier1: [], tier2: [] }),
        onFlag: async () => { throw new Error('must not flag'); },
    });
    assert.deepStrictEqual(result, { attempted: 1, failed: 0, flags: 0 });
    assert.strictEqual(seen.length, 1);
});

test('tier1 hit invokes onFlag with user, matches, and text', async () => {
    const flags = [];
    const result = await runCycle({
        store: talkingStore(), decodeForUser, sinceMs: 0, nowMs: 5000,
        transcribe: async () => ({ ok: true, text: 'go kys buddy' }),
        scan: () => ({ tier1: ['kys'], tier2: [] }),
        onFlag: async (flag) => { flags.push(flag); },
    });
    assert.strictEqual(result.flags, 1);
    assert.deepStrictEqual(flags[0], { userId: 'u1', matches: ['kys'], text: 'go kys buddy' });
});

test('transcription failures are counted, not thrown', async () => {
    const result = await runCycle({
        store: talkingStore(), decodeForUser, sinceMs: 0, nowMs: 5000,
        transcribe: async () => ({ ok: false, reason: 'http 500' }),
        scan: () => ({ tier1: [], tier2: [] }),
        onFlag: async () => {},
    });
    assert.deepStrictEqual(result, { attempted: 1, failed: 1, flags: 0 });
});

test('empty store attempts nothing', async () => {
    const result = await runCycle({
        store: createStore({ windowMs: 300000 }), decodeForUser, sinceMs: 0, nowMs: 5000,
        transcribe: async () => { throw new Error('must not transcribe'); },
        scan: () => ({ tier1: [], tier2: [] }),
        onFlag: async () => {},
    });
    assert.deepStrictEqual(result, { attempted: 0, failed: 0, flags: 0 });
});
