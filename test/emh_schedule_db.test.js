'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

// Scriptable pg stub, the same harness as squad_db_mutations.test.js: each
// queued entry is returned in order; an Error entry is thrown instead.
const captured = [];
const resultQueue = [];
const pg = require('pg');
pg.Pool.prototype.connect = async function connect() {
    return {
        query: async (text, params) => {
            captured.push({ text: String(text), params });
            const next = resultQueue.length ? resultQueue.shift() : { rows: [], rowCount: 0 };
            if (next instanceof Error) throw next;
            return next;
        },
        release: () => {},
    };
};

const store = require('../utils/emh_schedule_queries');

const row = (overrides = {}) => ({
    id: '7', host_id: 'h2', host_username: 'host_b', status: 'scheduled', status_source: 'auto',
    starts_at: new Date('2026-10-07T00:00:00Z'), ends_at: new Date('2026-10-07T01:00:00Z'), ...overrides,
});
const INPUT = {
    hostId: 'h1', hostUsername: 'host_a', createdBy: 'h1',
    startsAt: new Date('2026-10-07T00:30:00Z'), endsAt: new Date('2026-10-07T01:30:00Z'),
};

beforeEach(() => {
    captured.length = 0;
    resultQueue.length = 0;
});

test('a booking that overlaps an existing one returns the conflict and never inserts', async () => {
    resultQueue.push({ rows: [row()] });
    const result = await store.createBooking(INPUT);
    assert.strictEqual(result.conflict.hostUsername, 'host_b');
    assert.strictEqual(captured.some((c) => /INSERT/.test(c.text)), false);
});

test('a race lost at the constraint (23P01) still returns the conflict', async () => {
    const raced = Object.assign(new Error('conflicting key value violates exclusion constraint'), { code: '23P01' });
    resultQueue.push({ rows: [] }, raced, { rows: [row()] });
    const result = await store.createBooking(INPUT);
    assert.strictEqual(result.conflict.id, 7);
});

test('values are passed as parameters, never interpolated', async () => {
    resultQueue.push({ rows: [] }, { rows: [row({ host_id: 'h1', host_username: 'host_a' })] });
    const result = await store.createBooking(INPUT);
    assert.strictEqual(result.booking.hostUsername, 'host_a');
    const insert = captured.find((c) => /INSERT/.test(c.text));
    assert.ok(!insert.text.includes('host_a'));
    assert.ok(insert.params.includes('host_a'));
});

test('rescheduling a slot that is no longer scheduled reports it missing', async () => {
    resultQueue.push({ rows: [] }, { rows: [] });
    const result = await store.rescheduleBooking({ id: 7, startsAt: INPUT.startsAt, endsAt: INPUT.endsAt });
    assert.deepStrictEqual(result, { missing: true });
});

test('other errors are not swallowed', async () => {
    resultQueue.push({ rows: [] }, Object.assign(new Error('boom'), { code: '08006' }));
    await assert.rejects(store.createBooking(INPUT), /boom/);
});

test('the schema adds reminder_sent_at idempotently', async () => {
    await store.ensureEmhScheduleSchema();
    assert.ok(captured.some((c) => /ALTER TABLE emh_bookings ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ/.test(c.text)));
});

test('reminder candidates are scheduled, unreminded and inside the window, by parameter', async () => {
    const from = new Date('2026-10-07T00:00:00Z');
    const to = new Date('2026-10-07T00:05:00Z');
    resultQueue.push({ rows: [row({ reminder_sent_at: null })] });
    const [booking] = await store.listReminderCandidates(from, to);
    assert.strictEqual(booking.reminderSentAt, null);
    assert.match(captured[0].text, /status = 'scheduled' AND reminder_sent_at IS NULL AND starts_at > \$1 AND starts_at <= \$2/);
    assert.deepStrictEqual(captured[0].params, [from, to]);
});

test('marking a reminder is a claim that only succeeds once', async () => {
    resultQueue.push({ rows: [{ id: '7' }] }, { rows: [] });
    assert.strictEqual(await store.markReminderSent(7), true);
    assert.strictEqual(await store.markReminderSent(7), false);
    assert.match(captured[0].text, /reminder_sent_at IS NULL/);
    assert.deepStrictEqual(captured[0].params, [7]);
});
