'use strict';

const test = require('node:test');
const assert = require('node:assert');

function installMock(relativePath, mockExports) {
    const modulePath = require.resolve(relativePath);
    require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports: mockExports };
}

const calls = [];
const state = {};

function resetState() {
    calls.length = 0;
    state.expired = [];
    state.reminders = [];
    state.starts = [];
    state.cleanups = [];
    state.rsvps = [];
}
resetState();

installMock('../utils/squad_db', {
    expireOldApplications: async (days) => { calls.push(['expireOldApplications', days]); return state.expired; },
    fetchSquadById: async (id) => ({ id, name: 'ABC', owner_id: 'owner-1' }),
    fetchDuePracticeReminders: async (mins) => { calls.push(['fetchDuePracticeReminders', mins]); return state.reminders; },
    fetchDuePracticeStarts: async () => { calls.push(['fetchDuePracticeStarts']); return state.starts; },
    fetchDuePracticeCleanups: async (hours) => { calls.push(['fetchDuePracticeCleanups', hours]); return state.cleanups; },
    fetchRsvps: async () => state.rsvps,
    claimPracticeReminder: async (id) => { calls.push(['claimPracticeReminder', id]); return { id }; },
    claimPracticeStart: async (id) => { calls.push(['claimPracticeStart', id]); return { id }; },
    claimPracticeCleanup: async (id) => { calls.push(['claimPracticeCleanup', id]); return { id }; },
});

installMock('../handlers/squad_discovery', {
    finalizeApplicationCard: async (client, application) => { calls.push(['finalizeApplicationCard', application.id]); },
    dmUser: async (client, userId, { title }) => { calls.push(['dmUser', userId, title]); },
});

installMock('../utils/logger', { info: () => {}, warn: () => {}, error: (...a) => calls.push(['error', a.join(' ')]) });

const { runSquadSweep } = require('../jobs/squad-sweep');

const clientStub = { channels: { fetch: async () => ({ send: async () => {}, delete: async () => {} }) } };

test('sweep expires applications and notifies applicants', async () => {
    resetState();
    state.expired = [{ id: 9, squad_id: 1, user_id: 'u1', dm_message_id: 'm1' }];

    await runSquadSweep(clientStub);

    assert.deepStrictEqual(calls.find((c) => c[0] === 'expireOldApplications'), ['expireOldApplications', 7]);
    assert.ok(calls.some((c) => c[0] === 'finalizeApplicationCard' && c[1] === 9));
    assert.ok(calls.some((c) => c[0] === 'dmUser' && c[1] === 'u1' && c[2] === 'Application Expired'));
});

test('sweep sends reminders to yes-rsvps plus the creator, then starts and cleans up practices', async () => {
    resetState();
    state.reminders = [{ id: 3, squad_id: 1, created_by: 'owner-1', scheduled_at: new Date(), thread_id: 't' }];
    state.rsvps = [{ user_id: 'u2' }, { user_id: 'owner-1' }];
    state.starts = [{ id: 4, squad_id: 1, thread_id: 't' }];
    state.cleanups = [{ id: 5, squad_id: 1, thread_id: 't' }];

    await runSquadSweep(clientStub);

    const reminded = calls.filter((c) => c[0] === 'dmUser' && c[2] === 'Practice Reminder').map((c) => c[1]);
    assert.deepStrictEqual([...new Set(reminded)].sort(), ['owner-1', 'u2']);
    // Claim precedes the DMs, so overlapping sweeps cannot double-send.
    assert.ok(calls.findIndex((c) => c[0] === 'claimPracticeReminder') < calls.findIndex((c) => c[0] === 'dmUser' && c[2] === 'Practice Reminder'));
    assert.ok(calls.some((c) => c[0] === 'claimPracticeStart' && c[1] === 4));
    assert.ok(calls.some((c) => c[0] === 'claimPracticeCleanup' && c[1] === 5));
    assert.ok(!calls.some((c) => c[0] === 'error'));
});
