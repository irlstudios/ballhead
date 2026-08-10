'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { createStore, recordPacket, packetsBetween, dropUser } = require('../utils/voice_moderation/buffers');

const pkt = (n) => Buffer.from([n]);

test('packets older than the window are evicted on record', () => {
    const store = createStore({ windowMs: 1000 });
    recordPacket(store, 'u1', pkt(1), 0);
    recordPacket(store, 'u1', pkt(2), 500);
    recordPacket(store, 'u1', pkt(3), 1600);
    const got = packetsBetween(store, 0, 2000).get('u1');
    assert.deepStrictEqual(got.map((p) => p.at), [1600]);
});

test('packetsBetween filters to the requested range per user', () => {
    const store = createStore({ windowMs: 60000 });
    recordPacket(store, 'u1', pkt(1), 100);
    recordPacket(store, 'u1', pkt(2), 200);
    recordPacket(store, 'u2', pkt(3), 300);
    const got = packetsBetween(store, 150, 250);
    assert.deepStrictEqual([...got.keys()], ['u1']);
    assert.deepStrictEqual(got.get('u1').map((p) => p.at), [200]);
});

test('range bounds are inclusive of start and end', () => {
    const store = createStore({ windowMs: 60000 });
    recordPacket(store, 'u1', pkt(1), 100);
    recordPacket(store, 'u1', pkt(2), 200);
    const got = packetsBetween(store, 100, 200).get('u1');
    assert.strictEqual(got.length, 2);
});

test('a user with no packets in range is absent from the result', () => {
    const store = createStore({ windowMs: 60000 });
    recordPacket(store, 'u1', pkt(1), 100);
    assert.strictEqual(packetsBetween(store, 500, 600).size, 0);
});

test('dropUser removes all packets for that user only', () => {
    const store = createStore({ windowMs: 60000 });
    recordPacket(store, 'u1', pkt(1), 100);
    recordPacket(store, 'u2', pkt(2), 100);
    dropUser(store, 'u1');
    const got = packetsBetween(store, 0, 1000);
    assert.deepStrictEqual([...got.keys()], ['u2']);
});

test('packets keep arrival order for a user', () => {
    const store = createStore({ windowMs: 60000 });
    recordPacket(store, 'u1', pkt(1), 100);
    recordPacket(store, 'u1', pkt(2), 150);
    recordPacket(store, 'u1', pkt(3), 120);
    const got = packetsBetween(store, 0, 1000).get('u1');
    assert.deepStrictEqual(got.map((p) => p.at), [100, 150, 120]);
});

const { createPacer, paceTimestamp } = require('../utils/voice_moderation/buffers');

test('jittered arrivals snap to the 20ms frame grid', () => {
    const pacer = createPacer();
    const placed = [1000, 1022, 1039, 1061, 1078].map((at) => paceTimestamp(pacer, at));
    assert.deepStrictEqual(placed, [1000, 1020, 1040, 1060, 1080]);
});

test('a real pause re-anchors instead of stretching the grid', () => {
    const pacer = createPacer();
    assert.strictEqual(paceTimestamp(pacer, 1000), 1000);
    assert.strictEqual(paceTimestamp(pacer, 1020), 1020);
    assert.strictEqual(paceTimestamp(pacer, 1500), 1500);
    assert.strictEqual(paceTimestamp(pacer, 1521), 1520);
});

test('slightly early packets still land on the grid', () => {
    const pacer = createPacer();
    assert.strictEqual(paceTimestamp(pacer, 1000), 1000);
    assert.strictEqual(paceTimestamp(pacer, 1010), 1020);
    assert.strictEqual(paceTimestamp(pacer, 1030), 1040);
});
