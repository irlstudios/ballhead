'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const calls = [];
const state = { bookings: [], failList: false, failSend: false };
const stub = (relative, exports) => {
    const file = require.resolve(path.join('..', relative));
    require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub('utils/emh_schedule_queries', {
    listBookingsBetween: async (from, to) => {
        calls.push(['list', from, to]);
        if (state.failList) throw new Error('db down');
        return state.bookings;
    },
});

const { runEmhTodayPost } = require('../jobs/emh-today-post');
const { GYM_CLASS_GENERAL_CHANNEL_ID } = require('../config/constants');

// Noon Chicago on Tue 2026-11-10 (CST, UTC-6).
const NOW = new Date('2026-11-10T18:00:00Z');
const slot = (id, iso, status = 'scheduled') => ({
    id, hostId: `h${id}`, hostUsername: `host${id}`, status, eventId: null,
    startsAt: new Date(iso), endsAt: new Date(new Date(iso).getTime() + 3600000),
});
const client = {
    channels: {
        fetch: async (id) => {
            calls.push(['channel', id]);
            return {
                isTextBased: () => true,
                send: async (payload) => {
                    calls.push(['send', payload]);
                    if (state.failSend) throw new Error('missing perms');
                    return { id: 'm1' };
                },
            };
        },
    },
};
const named = (name) => calls.filter(([n]) => n === name);

beforeEach(() => {
    calls.length = 0;
    Object.assign(state, { bookings: [], failList: false, failSend: false });
});

test('looks from now to the end of the Chicago day', async () => {
    await runEmhTodayPost(client, NOW);
    const [[, from, to]] = named('list');
    assert.strictEqual(from.toISOString(), NOW.toISOString());
    assert.strictEqual(to.toISOString(), '2026-11-11T06:00:00.000Z');
});

test('posts one message in general chat without pinging anyone', async () => {
    state.bookings = [slot(1, '2026-11-11T01:00:00Z'), slot(2, '2026-11-11T03:00:00Z')];
    const result = await runEmhTodayPost(client, NOW);
    assert.strictEqual(result, 2);
    assert.deepStrictEqual(named('channel'), [['channel', GYM_CLASS_GENERAL_CHANNEL_ID]]);
    const [[, payload]] = named('send');
    assert.match(payload.content, /<@h1>/);
    assert.match(payload.content, /<@h2>/);
    assert.deepStrictEqual(payload.allowedMentions, { parse: [] });
});

test('skips cancelled and already-resolved slots, and posts nothing when none are left', async () => {
    state.bookings = [slot(1, '2026-11-11T01:00:00Z', 'cancelled'), slot(2, '2026-11-11T02:00:00Z', 'hosted')];
    const result = await runEmhTodayPost(client, NOW);
    assert.strictEqual(result, 0);
    assert.strictEqual(named('send').length, 0);
});

test('a database or Discord failure is logged, not thrown', async () => {
    state.failList = true;
    await assert.doesNotReject(runEmhTodayPost(client, NOW));
    state.failList = false;
    state.failSend = true;
    state.bookings = [slot(1, '2026-11-11T01:00:00Z')];
    await assert.doesNotReject(runEmhTodayPost(client, NOW));
});
