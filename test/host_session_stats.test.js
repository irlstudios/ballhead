'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
    SHEET_HEADER, eventChannelName, summariseSession, trackedMinutes, buildSessionRow, nudgeMessage,
} = require('../utils/host_session_stats');

const HOST_ID = '111';

test('the host is excluded from participant metrics', () => {
    const summary = summariseSession({
        hostId: HOST_ID,
        members: [
            { userId: HOST_ID, totalSeconds: 7200, joinCount: 1 },
            { userId: '222', totalSeconds: 600, joinCount: 1 },
            { userId: '333', totalSeconds: 1200, joinCount: 2 },
        ],
    });
    assert.strictEqual(summary.uniqueJoiners, 2);
    assert.strictEqual(summary.totalJoins, 3);
    assert.strictEqual(summary.avgMinutes, 15);
    assert.strictEqual(summary.totalPlayerMinutes, 30);
});

test('a visit too short to register a second still counts as a joiner', () => {
    const summary = summariseSession({
        hostId: HOST_ID,
        members: [{ userId: '222', totalSeconds: 0, joinCount: 1 }],
    });
    assert.strictEqual(summary.uniqueJoiners, 1);
    assert.strictEqual(summary.totalJoins, 1);
    assert.strictEqual(summary.avgMinutes, 0);
    assert.strictEqual(summary.medianMinutes, 0);
});

test('a member row with no join and no time is ignored', () => {
    const summary = summariseSession({
        hostId: HOST_ID,
        members: [{ userId: '222', totalSeconds: 0, joinCount: 0 }],
    });
    assert.strictEqual(summary.uniqueJoiners, 0);
});

test('an empty session summarises to zeroes rather than NaN', () => {
    const summary = summariseSession({ hostId: HOST_ID, members: [] });
    assert.deepStrictEqual(summary, {
        uniqueJoiners: 0, totalJoins: 0, avgMinutes: 0, medianMinutes: 0, totalPlayerMinutes: 0,
    });
});

test('median averages the middle pair on an even participant count', () => {
    const summary = summariseSession({
        hostId: HOST_ID,
        members: [
            { userId: '1', totalSeconds: 60 }, { userId: '2', totalSeconds: 120 },
            { userId: '3', totalSeconds: 180 }, { userId: '4', totalSeconds: 600 },
        ],
    });
    assert.strictEqual(summary.medianMinutes, 2.5);
    assert.strictEqual(summary.avgMinutes, 4);
});

test('tracked minutes run from the activity start, not the command', () => {
    assert.strictEqual(trackedMinutes({
        activityStartedAt: '2026-07-29T20:00:00Z',
        endedAt: '2026-07-29T21:30:00Z',
    }), 90);
});

test('tracked minutes are zero when the activity never started or time went backwards', () => {
    assert.strictEqual(trackedMinutes({ endedAt: '2026-07-29T21:30:00Z' }), 0);
    assert.strictEqual(trackedMinutes({
        activityStartedAt: '2026-07-29T21:30:00Z',
        endedAt: '2026-07-29T20:00:00Z',
    }), 0);
});

test('the channel name is trimmed so Discord never rejects the rename', () => {
    assert.strictEqual(eventChannelName('Roy'), 'Roy\'s EMH Session');
    assert.strictEqual(eventChannelName('  '), 'Host\'s EMH Session');
    assert.strictEqual(eventChannelName('x'.repeat(200)).length, 100);
});

test('the sheet row lines up with the header', () => {
    const row = buildSessionRow({
        session: {
            hostName: 'Roy', hostId: HOST_ID, channelId: '999', activityName: 'Chess in the Park',
            startedAt: '2026-07-29T19:50:00Z',
            activityStartedAt: '2026-07-29T20:00:00Z',
            endedAt: '2026-07-29T21:00:00Z',
            peakConcurrent: 8,
        },
        summary: summariseSession({
            hostId: HOST_ID,
            members: [{ userId: '222', totalSeconds: 600, joinCount: 1 }],
        }),
    });
    assert.strictEqual(row.length, SHEET_HEADER.length);
    assert.strictEqual(row[0], '2026-07-29');
    assert.strictEqual(row[4], 'Chess in the Park');
    assert.strictEqual(row[8], 60);
    assert.strictEqual(row[9], 1);
    assert.strictEqual(row[10], 8);
});

test('a session that never went live still produces a well-formed row', () => {
    const row = buildSessionRow({ session: { hostId: HOST_ID, endedAt: '2026-07-29T21:00:00Z' }, summary: {} });
    assert.strictEqual(row.length, SHEET_HEADER.length);
    assert.strictEqual(row[4], 'Unknown');
    assert.strictEqual(row[6], '');
    assert.strictEqual(row[8], 0);
});

test('the nudge always carries a jump link to the voice channel', () => {
    const message = nudgeMessage({ guildId: 'g', channelId: 'c', hostId: HOST_ID, activityName: 'Gartic Phone' });
    assert.match(message, /https:\/\/discord\.com\/channels\/g\/c/);
    assert.match(message, /Gartic Phone/);
    assert.match(message, /<@111>/);
});
