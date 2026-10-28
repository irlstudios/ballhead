'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const calls = [];
const state = { candidates: [], claimed: new Set(), failList: false, failClaim: false, failDm: false };
const stub = (relative, exports) => {
    const file = require.resolve(path.join('..', relative));
    require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub('utils/emh_schedule_queries', {
    listReminderCandidates: async (from, to) => {
        calls.push(['list', from, to]);
        if (state.failList) throw new Error('db down');
        return state.candidates.filter((b) => !state.claimed.has(b.id));
    },
    markReminderSent: async (id) => {
        calls.push(['mark', id]);
        if (state.failClaim) throw new Error('db down');
        if (state.claimed.has(id)) return false;
        state.claimed.add(id);
        return true;
    },
});
const realDms = require('../utils/host_session_dms');
stub('utils/host_session_dms', {
    ...realDms,
    sendHostDm: async (client, hostId, notice) => {
        calls.push(['dm', hostId, notice.title]);
        return !state.failDm;
    },
});

const { runEmhSessionReminders } = require('../jobs/emh-session-reminder');

const NOW = new Date('2026-10-06T00:00:00Z');
const slot = (id, hostId, minutesAhead) => ({
    id, hostId, status: 'scheduled', reminderSentAt: null, startsAt: new Date(NOW.getTime() + minutesAhead * 60000),
});
const named = (name) => calls.filter(([n]) => n === name);

beforeEach(() => {
    calls.length = 0;
    Object.assign(state, { candidates: [], claimed: new Set(), failList: false, failClaim: false, failDm: false });
});

test('a due slot gets one DM and is marked reminded', async () => {
    state.candidates = [slot(1, 'h1', 4)];
    const sent = await runEmhSessionReminders({}, NOW);
    assert.deepStrictEqual(sent, [{ id: 1, delivered: true }]);
    assert.deepStrictEqual(named('mark'), [['mark', 1]]);
    assert.deepStrictEqual(named('dm'), [['dm', 'h1', 'Session Reminder']]);
});

test('candidates are fetched for the next five minutes', async () => {
    await runEmhSessionReminders({}, NOW);
    const [[, from, to]] = named('list');
    assert.strictEqual(from.toISOString(), NOW.toISOString());
    assert.strictEqual(to.toISOString(), '2026-10-06T00:05:00.000Z');
});

test('a second run does not remind the same slot again', async () => {
    state.candidates = [slot(1, 'h1', 4)];
    await runEmhSessionReminders({}, NOW);
    const second = await runEmhSessionReminders({}, new Date(NOW.getTime() + 60000));
    assert.deepStrictEqual(second, []);
    assert.strictEqual(named('dm').length, 1);
});

test('a slot another run already claimed is skipped without a DM', async () => {
    const original = slot(1, 'h1', 4);
    state.candidates = [original, { ...original }];
    await runEmhSessionReminders({}, NOW);
    assert.strictEqual(named('dm').length, 1);
});

test('already reminded or out-of-window rows from the query are ignored', async () => {
    state.candidates = [{ ...slot(1, 'h1', 4), reminderSentAt: NOW }, slot(2, 'h2', 9), slot(3, 'h3', -1)];
    const sent = await runEmhSessionReminders({}, NOW);
    assert.deepStrictEqual(sent, []);
    assert.deepStrictEqual(named('dm'), []);
});

test('closed DMs still leave the slot marked so it is not retried', async () => {
    state.failDm = true;
    state.candidates = [slot(1, 'h1', 4), slot(2, 'h2', 3)];
    const sent = await runEmhSessionReminders({}, NOW);
    assert.deepStrictEqual(sent, [{ id: 1, delivered: false }, { id: 2, delivered: false }]);
    assert.deepStrictEqual(named('mark'), [['mark', 1], ['mark', 2]]);
});

test('a database failure is logged, not thrown', async () => {
    state.failList = true;
    assert.deepStrictEqual(await runEmhSessionReminders({}, NOW), []);
    state.failList = false;
    state.failClaim = true;
    state.candidates = [slot(1, 'h1', 4)];
    assert.deepStrictEqual(await runEmhSessionReminders({}, NOW), []);
    assert.deepStrictEqual(named('dm'), []);
});

test('a second run while one is in flight is skipped', async () => {
    state.candidates = [slot(1, 'h1', 4)];
    const first = runEmhSessionReminders({}, NOW);
    const second = await runEmhSessionReminders({}, NOW);
    await first;
    assert.strictEqual(second, null);
});
