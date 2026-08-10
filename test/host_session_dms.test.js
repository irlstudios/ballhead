'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
    trackingStartedNotice,
    noActivityNotice,
    wrapUpNotice,
    endedWithoutTrackingNotice,
    statusNotice,
    sendHostDm,
} = require('../utils/host_session_dms');

const flatten = (notice) => [notice.title, notice.subtitle, ...(notice.lines || [])].join('\n');

test('tracking started notice names the detected activity', () => {
    const notice = trackingStartedNotice({ activityName: 'Smash Karts' });
    const text = flatten(notice);
    assert.match(text, /Smash Karts/);
    assert.match(text, /[Tt]racking/);
});

test('no-activity warning explains the privacy setting and how long it waited', () => {
    const notice = noActivityNotice({ minutes: 5 });
    const text = flatten(notice);
    assert.match(text, /5 minutes/);
    assert.match(text, /Activity Privacy/);
    assert.match(text, /not being recorded|no stats/i);
});

test('wrap-up notice reports the session stats', () => {
    const notice = wrapUpNotice({
        session: {
            activityName: 'Smash Karts',
            activityStartedAt: '2026-08-10T01:00:00.000Z',
            endedAt: '2026-08-10T01:33:00.000Z',
            peakConcurrent: 4,
        },
        summary: {
            uniqueJoiners: 6, totalJoins: 8, avgMinutes: 12.5, medianMinutes: 10, totalPlayerMinutes: 75,
        },
    });
    const text = flatten(notice);
    assert.match(text, /Smash Karts/);
    assert.match(text, /33 min/);
    assert.match(text, /6/);
    assert.match(text, /4/);
    assert.match(text, /12\.5/);
});

test('ended-without-tracking notice says no stats were recorded', () => {
    const text = flatten(endedWithoutTrackingNotice());
    assert.match(text, /no stats|nothing was recorded/i);
    assert.match(text, /Activity Privacy/);
});

test('status notice while waiting for an activity says so', () => {
    const notice = statusNotice({
        session: {
            hostId: '111',
            activityStartedAt: null,
            startedAt: '2026-08-10T01:00:00.000Z',
        },
        members: [],
        currentParticipants: 2,
        now: new Date('2026-08-10T01:04:00.000Z'),
    });
    const text = flatten(notice);
    assert.match(text, /[Ww]aiting for an activity/);
    assert.match(text, /4 min/);
});

test('status notice for a live session reports tracked time and joiners', () => {
    const notice = statusNotice({
        session: {
            hostId: '111',
            activityName: 'Smash Karts',
            activityStartedAt: '2026-08-10T01:00:00.000Z',
            startedAt: '2026-08-10T00:55:00.000Z',
            peakConcurrent: 5,
        },
        members: [
            { userId: '111', totalSeconds: 0, joinCount: 1 },
            { userId: '222', totalSeconds: 300, joinCount: 1 },
            { userId: '333', totalSeconds: 0, joinCount: 1 },
        ],
        currentParticipants: 3,
        now: new Date('2026-08-10T01:20:00.000Z'),
    });
    const text = flatten(notice);
    assert.match(text, /Smash Karts/);
    assert.match(text, /20 min/);
    // The host is excluded from the joiner count.
    assert.match(text, /Unique joiners so far: \*\*2\*\*/);
    assert.match(text, /5/);
});

test('status notice omits the in-room count when the room could not be inspected', () => {
    const notice = statusNotice({
        session: {
            hostId: '111',
            activityName: 'Smash Karts',
            activityStartedAt: '2026-08-10T01:00:00.000Z',
            startedAt: '2026-08-10T00:55:00.000Z',
            peakConcurrent: 5,
        },
        members: [],
        currentParticipants: null,
        now: new Date('2026-08-10T01:20:00.000Z'),
    });
    assert.doesNotMatch(flatten(notice), /In the room with you now/);
});

test('sendHostDm delivers a components-v2 payload and reports success', async () => {
    const sent = [];
    const client = {
        users: { fetch: async () => ({ send: async (payload) => { sent.push(payload); } }) },
    };
    const ok = await sendHostDm(client, '111', trackingStartedNotice({ activityName: 'Smash Karts' }));
    assert.strictEqual(ok, true);
    assert.strictEqual(sent.length, 1);
    assert.ok(sent[0].components.length > 0);
});

test('sendHostDm swallows delivery failures and reports them', async () => {
    const client = {
        users: { fetch: async () => { throw new Error('DMs closed'); } },
    };
    const ok = await sendHostDm(client, '111', trackingStartedNotice({ activityName: 'Smash Karts' }));
    assert.strictEqual(ok, false);
});
