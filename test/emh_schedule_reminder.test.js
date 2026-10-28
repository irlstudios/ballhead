'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { isReminderDue, REMINDER_LEAD_MINUTES } = require('../utils/emh_schedule');
const { sessionReminderNotice } = require('../utils/host_session_dms');

const NOW = new Date('2026-10-06T00:00:00Z');
const inMinutes = (minutes) => new Date(NOW.getTime() + minutes * 60000);
const booking = (overrides = {}) => ({ id: 1, hostId: 'h1', status: 'scheduled', reminderSentAt: null, startsAt: inMinutes(4), ...overrides });

test('the lead is five minutes', () => {
    assert.strictEqual(REMINDER_LEAD_MINUTES, 5);
});

test('a scheduled, unreminded slot starting within five minutes is due', () => {
    assert.strictEqual(isReminderDue(booking(), NOW), true);
    assert.strictEqual(isReminderDue(booking({ startsAt: inMinutes(5) }), NOW), true);
    assert.strictEqual(isReminderDue(booking({ startsAt: inMinutes(0.5) }), NOW), true);
});

test('a slot more than five minutes out is not due yet', () => {
    assert.strictEqual(isReminderDue(booking({ startsAt: inMinutes(5.01) }), NOW), false);
});

test('a slot that has started or passed is never reminded', () => {
    assert.strictEqual(isReminderDue(booking({ startsAt: NOW }), NOW), false);
    assert.strictEqual(isReminderDue(booking({ startsAt: inMinutes(-1) }), NOW), false);
});

test('an already reminded slot is not due again', () => {
    assert.strictEqual(isReminderDue(booking({ reminderSentAt: inMinutes(-1) }), NOW), false);
});

test('cancelled or resolved slots are not reminded', () => {
    for (const status of ['cancelled', 'hosted', 'no_show']) {
        assert.strictEqual(isReminderDue(booking({ status }), NOW), false, status);
    }
});

test('the reminder shows the start as a Discord timestamp and lists the setup steps', () => {
    const notice = sessionReminderNotice({ startsAt: new Date('2026-10-06T00:05:00Z') });
    const text = [notice.title, notice.subtitle, ...notice.lines].join('\n');
    const unix = Date.parse('2026-10-06T00:05:00Z') / 1000;
    assert.match(text, new RegExp(`<t:${unix}:t>`));
    assert.match(text, new RegExp(`<t:${unix}:R>`));
    assert.match(text, /Share your detected activities/);
    assert.match(text, /JOIN TO MAKE PERSONAL VC/);
    assert.match(text, /\/room event start/);
    assert.match(text, /Start Session/);
    assert.match(text, /\/room event winner/);
    assert.match(text, /^[\x20-\x7E\n]*$/, 'keyboard characters only');
});
