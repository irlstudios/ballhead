'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { setImmediate } = require('node:timers');

const calls = [];
const state = { due: [], sessions: [], hangRender: false, upcoming: [], hangEvents: false };
const stub = (relative, exports) => {
    const file = require.resolve(path.join('..', relative));
    require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub('utils/emh_schedule_queries', {
    listDueBookings: async () => state.due,
    listSessionsForHosts: async (hostIds, from, to) => {
        calls.push(['sessions', hostIds, from, to]);
        return state.sessions;
    },
    setBookingStatus: async (id, status) => calls.push(['set', id, status]),
    listUpcomingBookings: async () => state.upcoming,
});
stub('utils/emh_schedule_sheet', {
    renderMonthlyView: () => {
        calls.push(['render']);
        return state.hangRender ? new Promise(() => {}) : Promise.resolve(true);
    },
});

stub('utils/emh_events', {
    reconcileBookingEvent: async (client, id) => {
        calls.push(['event-sync', id]);
        if (state.hangEvents) await new Promise(() => {});
    },
});

const { runEmhScheduleSync } = require('../jobs/emh-schedule-sync');

const NOW = new Date('2026-10-06T03:00:00Z');
const slot = (id, hostId, start) => ({
    id, hostId, startsAt: new Date(start), endsAt: new Date(new Date(start).getTime() + 3600000),
});

beforeEach(() => {
    calls.length = 0;
    Object.assign(state, { due: [], sessions: [], hangRender: false, upcoming: [], hangEvents: false });
});

test('due slots resolve to hosted or no-show and the sheet redraws', async () => {
    state.due = [slot(1, 'h1', '2026-10-06T00:00:00Z'), slot(2, 'h2', '2026-10-06T01:00:00Z')];
    state.sessions = [{ hostId: 'h1', startedAt: new Date('2026-10-06T00:05:00Z'), endedAt: new Date('2026-10-06T00:50:00Z') }];
    const decided = await runEmhScheduleSync(NOW);
    assert.deepStrictEqual(decided, [{ id: 1, status: 'hosted' }, { id: 2, status: 'no_show' }]);
    assert.deepStrictEqual(calls.filter(([name]) => name === 'set'), [['set', 1, 'hosted'], ['set', 2, 'no_show']]);
    assert.strictEqual(calls.at(-1)[0], 'render');
});

test('sessions are fetched once, for the due hosts, from the early grace window', async () => {
    state.due = [slot(1, 'h1', '2026-10-06T00:00:00Z'), slot(2, 'h1', '2026-10-06T01:00:00Z')];
    await runEmhScheduleSync(NOW);
    const fetches = calls.filter(([name]) => name === 'sessions');
    assert.strictEqual(fetches.length, 1);
    assert.deepStrictEqual(fetches[0][1], ['h1']);
    assert.strictEqual(fetches[0][2].toISOString(), '2026-10-05T23:45:00.000Z');
});

test('nothing due still redraws (the month may have rolled over)', async () => {
    const decided = await runEmhScheduleSync(NOW);
    assert.deepStrictEqual(decided, []);
    assert.deepStrictEqual(calls, [['render']]);
});

test('a second run while one is in flight is skipped', async () => {
    const first = runEmhScheduleSync(NOW);
    const second = await runEmhScheduleSync(NOW);
    await first;
    assert.strictEqual(second, null);
});

// A Sheets call that never returns must not freeze Hosted / No-Show tracking.
test('a hung render does not block the next run from resolving slots', async () => {
    state.hangRender = true;
    void runEmhScheduleSync(NOW);
    await new Promise((resolve) => setImmediate(resolve));
    state.hangRender = false;
    state.due = [slot(1, 'h1', '2026-10-06T00:00:00Z')];
    const decided = await runEmhScheduleSync(NOW);
    assert.deepStrictEqual(decided, [{ id: 1, status: 'no_show' }]);
});

test('resolved slots and upcoming slots without an event are synced alongside the redraw', async () => {
    state.due = [slot(1, 'h1', '2026-10-06T00:00:00Z'), slot(2, 'h2', '2026-10-06T01:00:00Z')];
    state.upcoming = [{ id: 3, eventId: null }, { id: 4, eventId: 'ev-4' }];
    await runEmhScheduleSync(NOW, { client: {} });
    assert.deepStrictEqual(calls.filter(([name]) => name === 'event-sync'), [['event-sync', 1], ['event-sync', 2], ['event-sync', 3]]);
    assert.ok(calls.some(([name]) => name === 'render'));
});

test('a hung redraw does not stop the Discord event pass', async () => {
    state.hangRender = true;
    state.upcoming = [{ id: 3, eventId: null }];
    void runEmhScheduleSync(NOW, { client: {} });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepStrictEqual(calls.filter(([name]) => name === 'event-sync'), [['event-sync', 3]]);
});

test('no client means no Discord work', async () => {
    state.due = [slot(1, 'h1', '2026-10-06T00:00:00Z')];
    state.upcoming = [{ id: 3, eventId: null }];
    await runEmhScheduleSync(NOW);
    assert.strictEqual(calls.some(([name]) => name === 'event-sync'), false);
});

test('a slow event pass is not doubled by the next tick, and does not block resolving', async () => {
    state.hangEvents = true;
    state.upcoming = [{ id: 3, eventId: null }];
    void runEmhScheduleSync(NOW, { client: {} });
    await new Promise((resolve) => setImmediate(resolve));
    state.due = [slot(1, 'h1', '2026-10-06T00:00:00Z')];
    const decided = await runEmhScheduleSync(NOW, { client: {} });
    assert.deepStrictEqual(decided, [{ id: 1, status: 'no_show' }]);
    assert.deepStrictEqual(calls.filter(([name]) => name === 'event-sync'), [['event-sync', 3]]);
});
