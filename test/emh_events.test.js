'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { setImmediate } = require('node:timers');
const { RESTJSONErrorCodes } = require('discord.js');

const calls = [];
// The fake bookings table: id -> booking.
const rows = new Map();
const stub = (relative, exports) => {
    const file = require.resolve(path.join('..', relative));
    require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub('utils/emh_schedule_queries', {
    getBooking: async (id) => (rows.has(id) ? { ...rows.get(id) } : null),
    setBookingEventId: async (id, eventId) => {
        calls.push(['store', id, eventId]);
        rows.set(id, { ...rows.get(id), eventId });
    },
});

const events = require('../utils/emh_events');
const { GYM_CLASS_GUILD_ID } = require('../config/constants');

const booking = (overrides = {}) => ({
    id: 7, hostId: 'h1', hostUsername: 'grim_lucas', status: 'scheduled',
    startsAt: new Date('2099-01-02T01:00:00Z'), endsAt: new Date('2099-01-02T02:00:00Z'), eventId: null, ...overrides,
});
const ascii = (text) => /^[\x20-\x7E\n]*$/.test(text);
const apiError = (code, message = 'api error') => Object.assign(new Error(message), { code });
const tick = () => new Promise((resolve) => setImmediate(resolve));

// A guild whose scheduledEvents manager records every call. flags.editError /
// deleteError are thrown from edit / delete; flags.slowCreate holds create
// until released.
let flags = {};
let createCount = 0;
const client = {
    guilds: {
        fetch: async (id) => {
            calls.push(['guild', id]);
            return {
                scheduledEvents: {
                    create: async (payload) => {
                        calls.push(['create', payload.scheduledStartTime.toISOString()]);
                        if (flags.failCreate) throw new Error('missing access');
                        if (flags.slowCreate) await flags.slowCreate;
                        createCount += 1;
                        return { id: `ev-${createCount}` };
                    },
                    edit: async (id, payload) => {
                        calls.push(['edit', id, payload.scheduledStartTime.toISOString()]);
                        if (flags.editError) throw flags.editError;
                        return { id };
                    },
                    delete: async (id) => {
                        calls.push(['delete', id]);
                        if (flags.deleteError) throw flags.deleteError;
                    },
                },
            };
        },
    },
};
const named = (name) => calls.filter(([n]) => n === name);

beforeEach(() => {
    calls.length = 0;
    rows.clear();
    flags = {};
    createCount = 0;
});

test('eventPayload is a guild-only external event on the booked times that pitches the GC Activity', () => {
    const payload = events.eventPayload(booking());
    assert.strictEqual(payload.entityType, 3);
    assert.strictEqual(payload.privacyLevel, 2);
    assert.strictEqual(payload.scheduledStartTime.toISOString(), '2099-01-02T01:00:00.000Z');
    assert.strictEqual(payload.scheduledEndTime.toISOString(), '2099-01-02T02:00:00.000Z');
    assert.match(payload.name, /grim_lucas/);
    assert.match(payload.description, /GC Activity/);
    assert.ok(payload.entityMetadata.location.length <= 100);
    assert.ok(ascii(payload.name) && ascii(payload.description) && ascii(payload.entityMetadata.location));
});

test('eventPayload keeps the name within Discord\'s 100 character limit', () => {
    assert.ok(events.eventPayload(booking({ hostUsername: 'x'.repeat(150) })).name.length <= 100);
});

test('eventUrl links to the event in the Gym Class server', () => {
    assert.strictEqual(events.eventUrl('123'), `https://discord.com/events/${GYM_CLASS_GUILD_ID}/123`);
});

test('todayPost is null when nothing is booked', () => {
    assert.strictEqual(events.todayPost([]), null);
});

test('todayPost lists each slot in time order with the host and its event link', () => {
    const late = booking({ id: 2, hostId: 'h2', startsAt: new Date('2099-01-02T03:30:00Z'), eventId: 'ev-2' });
    const early = booking({ id: 1, hostId: 'h1', eventId: null });
    const text = events.todayPost([late, early]);
    const lines = text.split('\n');
    const first = lines.findIndex((line) => line.includes('<@h1>'));
    const second = lines.findIndex((line) => line.includes('<@h2>'));
    assert.ok(first > 0 && second > first, 'earlier slot listed first');
    assert.ok(lines[second].includes(`(${events.eventUrl('ev-2')})`));
    assert.doesNotMatch(lines[first], /discord\.com\/events/);
    assert.match(text, /GC Activity/);
    assert.ok(ascii(text));
});

test('todayPost stays under Discord\'s 2000 character limit on a packed day', () => {
    const many = Array.from({ length: 40 }, (_, i) => booking({
        id: i, hostId: `${'9'.repeat(19)}`, eventId: `${'1'.repeat(19)}`,
        startsAt: new Date(Date.UTC(2099, 0, 2, 0, i)),
    }));
    const text = events.todayPost(many);
    assert.ok(text.length < 2000, `length ${text.length}`);
    assert.match(text, new RegExp(`and ${40 - events.POST_SLOT_LIMIT} more`));
});

test('a scheduled slot without an event gets one and its id is stored', async () => {
    rows.set(7, booking());
    const id = await events.reconcileBookingEvent(client, 7);
    assert.strictEqual(id, 'ev-1');
    assert.deepStrictEqual(named('guild'), [['guild', GYM_CLASS_GUILD_ID]]);
    assert.deepStrictEqual(named('store'), [['store', 7, 'ev-1']]);
});

test('a rescheduled slot moves its existing event instead of making a new one', async () => {
    rows.set(7, booking({ eventId: 'ev-old' }));
    const id = await events.reconcileBookingEvent(client, 7);
    assert.strictEqual(id, 'ev-old');
    assert.deepStrictEqual(named('edit'), [['edit', 'ev-old', '2099-01-02T01:00:00.000Z']]);
    assert.strictEqual(named('create').length, 0);
});

test('an event deleted by hand in Discord is recreated', async () => {
    flags.editError = apiError(RESTJSONErrorCodes.UnknownGuildScheduledEvent);
    rows.set(7, booking({ eventId: 'ev-gone' }));
    const id = await events.reconcileBookingEvent(client, 7);
    assert.strictEqual(id, 'ev-1');
    assert.deepStrictEqual(named('store'), [['store', 7, 'ev-1']]);
});

test('any other edit failure keeps the old event and its id (no duplicate)', async () => {
    flags.editError = apiError(50035, 'Cannot edit an active event');
    rows.set(7, booking({ eventId: 'ev-old' }));
    const id = await events.reconcileBookingEvent(client, 7);
    assert.strictEqual(id, 'ev-old');
    assert.strictEqual(named('create').length, 0);
    assert.strictEqual(named('store').length, 0);
});

test('a cancelled or resolved slot has its event deleted and the id cleared', async () => {
    for (const status of ['cancelled', 'hosted', 'no_show']) {
        calls.length = 0;
        rows.set(7, booking({ status, eventId: 'ev-1' }));
        await events.reconcileBookingEvent(client, 7);
        assert.deepStrictEqual(named('delete'), [['delete', 'ev-1']], status);
        assert.deepStrictEqual(named('store'), [['store', 7, null]], status);
    }
});

test('an event already gone counts as deleted; another delete failure keeps the id for later', async () => {
    flags.deleteError = apiError(RESTJSONErrorCodes.UnknownGuildScheduledEvent);
    rows.set(7, booking({ status: 'cancelled', eventId: 'ev-1' }));
    await events.reconcileBookingEvent(client, 7);
    assert.deepStrictEqual(named('store'), [['store', 7, null]]);

    calls.length = 0;
    flags.deleteError = new Error('rate limited');
    rows.set(7, booking({ status: 'cancelled', eventId: 'ev-1' }));
    await events.reconcileBookingEvent(client, 7);
    assert.strictEqual(named('store').length, 0);
});

test('book then cancel while the create is in flight leaves no event behind', async () => {
    let release;
    flags.slowCreate = new Promise((resolve) => { release = resolve; });
    rows.set(7, booking());
    const booked = events.reconcileBookingEvent(client, 7);
    await tick();
    rows.set(7, { ...rows.get(7), status: 'cancelled' });
    const cancelled = events.reconcileBookingEvent(client, 7);
    release();
    await Promise.all([booked, cancelled]);
    assert.deepStrictEqual(named('delete'), [['delete', 'ev-1']]);
    assert.strictEqual(rows.get(7).eventId, null);
});

test('book then reschedule while the create is in flight ends with one event on the new time', async () => {
    let release;
    flags.slowCreate = new Promise((resolve) => { release = resolve; });
    rows.set(7, booking());
    const booked = events.reconcileBookingEvent(client, 7);
    await tick();
    rows.set(7, { ...rows.get(7), startsAt: new Date('2099-01-03T01:00:00Z'), endsAt: new Date('2099-01-03T02:00:00Z') });
    const moved = events.reconcileBookingEvent(client, 7);
    release();
    await Promise.all([booked, moved]);
    assert.strictEqual(named('create').length, 1);
    assert.deepStrictEqual(named('edit'), [['edit', 'ev-1', '2099-01-03T01:00:00.000Z']]);
});

test('a failed create or a missing booking never throws', async () => {
    flags.failCreate = true;
    rows.set(7, booking());
    assert.strictEqual(await events.reconcileBookingEvent(client, 7), null);
    assert.strictEqual(await events.reconcileBookingEvent(client, 999), null);
    assert.strictEqual(named('store').length, 0);
});

test('an event whose id cannot be stored is deleted so it is never orphaned', async () => {
    const realStore = require('../utils/emh_schedule_queries');
    const original = realStore.setBookingEventId;
    realStore.setBookingEventId = async () => {
        throw new Error('db down');
    };
    try {
        rows.set(7, booking());
        assert.strictEqual(await events.reconcileBookingEvent(client, 7), null);
        assert.deepStrictEqual(named('delete'), [['delete', 'ev-1']]);
    } finally {
        realStore.setBookingEventId = original;
    }
});
