'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { sendReengagementBatch, DM_BLOCKED_CODE } = require('../programs/reengagement/sender');

const adapter = {
    id: 'ff',
    getChangelogSince: async () => ['S42: new rewards'],
};

const member = (userId, overrides = {}) => ({
    userId,
    inGameName: `player-${userId}`,
    lastActiveSeason: 41,
    lapsedSeasons: 2,
    achievements: { points: '10', wins: '1', mmr: '5000' },
    ...overrides,
});

// Builds an injectable deps object backed by simple in-memory fakes.
function makeDeps(overrides = {}) {
    const sentTo = [];
    const statuses = [];
    const reserved = new Set();
    return {
        sentTo,
        statuses,
        deps: {
            allowlist: [],
            isOptedOut: async () => false,
            reserve: async ({ userId, lastActiveSeason }) => {
                const key = `${userId}:${lastActiveSeason}`;
                if (reserved.has(key)) return null;
                reserved.add(key);
                return key;
            },
            updateStatus: async (id, status) => statuses.push({ id, status }),
            sendDm: async (_client, userId) => {
                sentTo.push(userId);
                return `msg-${userId}`;
            },
            sleep: async () => {},
            maxPerRun: 25,
            throttleMs: 0,
            log: { info() {}, error() {}, warn() {} },
            ...overrides,
        },
    };
}

test('sends to every eligible target', async () => {
    const { sentTo, deps } = makeDeps();
    const summary = await sendReengagementBatch({
        client: {}, adapter, targets: [member('1'), member('2')], deps,
    });
    assert.deepStrictEqual(sentTo, ['1', '2']);
    assert.strictEqual(summary.sent, 2);
});

test('allowlist blocks anyone not on the list', async () => {
    const { sentTo, deps } = makeDeps({ allowlist: ['2'] });
    const summary = await sendReengagementBatch({
        client: {}, adapter, targets: [member('1'), member('2')], deps,
    });
    assert.deepStrictEqual(sentTo, ['2']);
    assert.strictEqual(summary.sent, 1);
    assert.strictEqual(summary.skipped, 1);
});

test('opted-out users are skipped', async () => {
    const { sentTo, deps } = makeDeps({ isOptedOut: async (id) => id === '1' });
    const summary = await sendReengagementBatch({
        client: {}, adapter, targets: [member('1'), member('2')], deps,
    });
    assert.deepStrictEqual(sentTo, ['2']);
    assert.strictEqual(summary.skipped, 1);
});

test('already-contacted targets are deduped, not re-sent', async () => {
    const { sentTo, deps } = makeDeps();
    // Same user appears twice with the same lapse season.
    const summary = await sendReengagementBatch({
        client: {}, adapter, targets: [member('1'), member('1')], deps,
    });
    assert.deepStrictEqual(sentTo, ['1']);
    assert.strictEqual(summary.deduped, 1);
});

test('per-run cap limits the number of sends', async () => {
    const { sentTo, deps } = makeDeps({ maxPerRun: 1 });
    const summary = await sendReengagementBatch({
        client: {}, adapter, targets: [member('1'), member('2')], deps,
    });
    assert.strictEqual(sentTo.length, 1);
    assert.strictEqual(summary.attempted, 1);
});

test('a blocked DM is recorded and does not abort the batch', async () => {
    const { statuses, deps } = makeDeps({
        sendDm: async (_client, userId) => {
            if (userId === '1') {
                const err = new Error('blocked');
                err.code = DM_BLOCKED_CODE;
                throw err;
            }
            return `msg-${userId}`;
        },
    });
    const summary = await sendReengagementBatch({
        client: {}, adapter, targets: [member('1'), member('2')], deps,
    });
    assert.strictEqual(summary.dmBlocked, 1);
    assert.strictEqual(summary.sent, 1);
    assert.ok(statuses.some((s) => s.status === 'dm_blocked'));
    assert.ok(statuses.some((s) => s.status === 'sent'));
});
