'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { setImmediate } = require('node:timers');

const calls = [];
const state = { due: [], sessions: [], hangRender: false };
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
});
stub('utils/emh_schedule_sheet', {
    renderMonthlyView: () => {
        calls.push(['render']);
        return state.hangRender ? new Promise(() => {}) : Promise.resolve(true);
    },
});

const { runEmhScheduleSync } = require('../jobs/emh-schedule-sync');

const NOW = new Date('2026-10-06T03:00:00Z');
const slot = (id, hostId, start) => ({
    id, hostId, startsAt: new Date(start), endsAt: new Date(new Date(start).getTime() + 3600000),
});

beforeEach(() => {
    calls.length = 0;
    Object.assign(state, { due: [], sessions: [], hangRender: false });
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
