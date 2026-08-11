'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { pickCaptureClient } = require('../utils/voice_moderation/capture');

const fakeClient = (id, { guildIds = ['g1'], ready = true } = {}) => ({
    user: { id },
    isReady: () => ready,
    guilds: { cache: new Map(guildIds.map((guildId) => [guildId, {}])) },
});

test('prefers a free worker over the main client', () => {
    const mainClient = fakeClient('main');
    const worker = fakeClient('w1');
    const picked = pickCaptureClient({
        mainClient, workers: [worker], guildId: 'g1', busyUserIds: new Set(),
    });
    assert.strictEqual(picked, worker);
});

test('skips workers not invited to the guild', () => {
    const mainClient = fakeClient('main');
    const stranger = fakeClient('w1', { guildIds: ['other-guild'] });
    const picked = pickCaptureClient({
        mainClient, workers: [stranger], guildId: 'g1', busyUserIds: new Set(),
    });
    assert.strictEqual(picked, mainClient);
});

test('skips workers already capturing in the guild', () => {
    const mainClient = fakeClient('main');
    const busy = fakeClient('w1');
    const free = fakeClient('w2');
    const picked = pickCaptureClient({
        mainClient, workers: [busy, free], guildId: 'g1', busyUserIds: new Set(['w1']),
    });
    assert.strictEqual(picked, free);
});

test('skips workers that are not logged in yet', () => {
    const mainClient = fakeClient('main');
    const offline = fakeClient('w1', { ready: false });
    const picked = pickCaptureClient({
        mainClient, workers: [offline], guildId: 'g1', busyUserIds: new Set(),
    });
    assert.strictEqual(picked, mainClient);
});

test('falls back to the main client when every worker is taken', () => {
    const mainClient = fakeClient('main');
    const picked = pickCaptureClient({
        mainClient, workers: [fakeClient('w1')], guildId: 'g1', busyUserIds: new Set(['w1']),
    });
    assert.strictEqual(picked, mainClient);
});

test('returns null when the main client is busy too', () => {
    const mainClient = fakeClient('main');
    const picked = pickCaptureClient({
        mainClient, workers: [fakeClient('w1')], guildId: 'g1',
        busyUserIds: new Set(['w1', 'main']),
    });
    assert.strictEqual(picked, null);
});
