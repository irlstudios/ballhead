'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { setImmediate } = require('node:timers');

// Stub the Sheets client and the queries through the require cache so the
// renderer runs without Google or Postgres.
const writes = [];
const optionsSeen = [];
const state = { tabs: ['Monthly View (Bot Preview)'], fail: false, bookings: [], delays: [] };
const fakeSheets = {
    spreadsheets: {
        get: async (_params, options) => {
            optionsSeen.push(options);
            return { data: { sheets: state.tabs.map((title, i) => ({ properties: { title, sheetId: i + 1 } })) } };
        },
        batchUpdate: async ({ requestBody }, options) => {
            optionsSeen.push(options);
            const delay = state.delays.shift() || 0;
            if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
            writes.push(requestBody.requests);
            const add = requestBody.requests.find((r) => r.addSheet);
            return { data: { replies: add ? [{ addSheet: { properties: { sheetId: 99 } } }] : [] } };
        },
    },
};
const stub = (relative, exports) => {
    const file = require.resolve(path.join('..', relative));
    require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub('utils/sheets_cache', {
    getSheetsClient: async () => {
        if (state.fail) throw new Error('sheets down');
        return fakeSheets;
    },
});
stub('utils/emh_schedule_queries', { listBookingsBetween: async () => state.bookings });

const { renderMonthlyView, resetRenderState } = require('../utils/emh_schedule_sheet');

const NOW = new Date('2026-10-15T17:00:00Z');
const updates = () => writes.flat().filter((r) => r.updateCells);

beforeEach(() => {
    writes.length = 0;
    optionsSeen.length = 0;
    Object.assign(state, { tabs: ['Monthly View (Bot Preview)'], fail: false, bookings: [], delays: [] });
    resetRenderState();
});

test('writes the grid to the preview tab, then skips an identical rerender', async () => {
    assert.strictEqual(await renderMonthlyView(NOW), true);
    assert.strictEqual(await renderMonthlyView(NOW), false);
    assert.strictEqual(updates().length, 1);
    assert.strictEqual(updates()[0].updateCells.range.sheetId, 1);
});

test('creates the tab when it is missing and merges the title row', async () => {
    state.tabs = ['Monthly View'];
    await renderMonthlyView(NOW);
    const requests = writes.flat();
    assert.ok(requests.some((r) => r.addSheet?.properties.title === 'Monthly View (Bot Preview)'));
    assert.ok(requests.some((r) => r.mergeCells));
    assert.strictEqual(updates()[0].updateCells.range.sheetId, 99);
});

test('never touches the real Monthly View tab by default', async () => {
    state.tabs = ['Monthly View', 'Monthly View (Bot Preview)'];
    await renderMonthlyView(NOW);
    assert.strictEqual(updates()[0].updateCells.range.sheetId, 2);
});

test('a sheets failure never throws and is retried on the next call', async () => {
    state.fail = true;
    assert.strictEqual(await renderMonthlyView(NOW), false);
    state.fail = false;
    assert.strictEqual(await renderMonthlyView(NOW), true);
});

// The first render reads the old (empty) data and is slow to write; the second
// reads the new booking and would write instantly. Without the queue the old
// write would land last and wipe the booking off the sheet.
test('renders are serialized so older data cannot land last', async () => {
    state.delays = [30];
    const booking = { hostUsername: 'host_a', status: 'scheduled', startsAt: new Date('2026-10-16T00:00:00Z'), endsAt: new Date('2026-10-16T01:00:00Z') };
    const first = renderMonthlyView(NOW);
    await new Promise((resolve) => setImmediate(resolve));
    state.bookings = [booking];
    const second = renderMonthlyView(NOW);
    await Promise.all([first, second]);
    assert.strictEqual(updates().length, 2);
    const last = updates().at(-1).updateCells.rows;
    assert.match(JSON.stringify(last), /host_a/);
});

// gaxios has no default timeout; without one a stalled request would hold the
// render queue forever.
test('every sheets call carries a timeout', async () => {
    state.tabs = ['Monthly View'];
    await renderMonthlyView(NOW);
    assert.ok(optionsSeen.length >= 3);
    assert.ok(optionsSeen.every((options) => options?.timeout > 0));
});
