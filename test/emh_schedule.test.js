'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const rules = require('../utils/emh_schedule');

// Sat 2026-10-03 10:00 PM CDT
const SAT_NIGHT = new Date('2026-10-04T03:00:00Z');
// Tue 2026-09-29 noon CDT
const TUESDAY = new Date('2026-09-29T17:00:00Z');

test('the week runs Sunday to the next Sunday in Central time', () => {
    const week = rules.weekBounds(TUESDAY);
    assert.strictEqual(week.start, '2026-09-27');
    assert.strictEqual(week.end, '2026-10-04');
    assert.strictEqual(week.startInstant.toISOString(), '2026-09-27T05:00:00.000Z');
});

test('saturday night only offers saturday and rejects sunday as next week', () => {
    assert.deepStrictEqual(rules.bookableDays(SAT_NIGHT), [{ value: '2026-10-03', label: 'Sat 10/3' }]);
    const result = rules.validateBooking({ day: '2026-10-04', time: '7PM', lengthMinutes: 60, now: SAT_NIGHT });
    assert.strictEqual(result.ok, false);
    assert.match(result.reason, /this week/);
});

test('bookable days run from today through saturday', () => {
    const days = rules.bookableDays(TUESDAY).map((d) => d.label);
    assert.deepStrictEqual(days, ['Tue 9/29', 'Wed 9/30', 'Thu 10/1', 'Fri 10/2', 'Sat 10/3']);
});

test('time parsing accepts the documented formats only', () => {
    assert.deepStrictEqual(rules.parseTime('7PM'), { hour: 19, minute: 0 });
    assert.deepStrictEqual(rules.parseTime('7 pm'), { hour: 19, minute: 0 });
    assert.deepStrictEqual(rules.parseTime('7:30PM'), { hour: 19, minute: 30 });
    assert.deepStrictEqual(rules.parseTime('12AM'), { hour: 0, minute: 0 });
    assert.deepStrictEqual(rules.parseTime('12PM'), { hour: 12, minute: 0 });
    for (const bad of ['9:45', '19:00', '13PM', '7:60PM', '', 'seven', null]) {
        assert.strictEqual(rules.parseTime(bad), null, `should reject ${bad}`);
    }
});

test('a valid booking returns absolute start and end instants', () => {
    const result = rules.validateBooking({ day: '2026-10-03', time: '11PM', lengthMinutes: 60, now: SAT_NIGHT });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.startsAt.toISOString(), '2026-10-04T04:00:00.000Z');
    assert.strictEqual(result.endsAt.toISOString(), '2026-10-04T05:00:00.000Z');
});

test('a slot may run past saturday midnight when it starts inside the week', () => {
    const result = rules.validateBooking({ day: '2026-10-03', time: '11:30PM', lengthMinutes: 120, now: SAT_NIGHT });
    assert.strictEqual(result.ok, true);
});

test('past times, bad times, bad days and bad lengths are rejected with reasons', () => {
    const past = rules.validateBooking({ day: '2026-10-03', time: '9PM', lengthMinutes: 60, now: SAT_NIGHT });
    assert.match(past.reason, /already passed/);
    const badTime = rules.validateBooking({ day: '2026-10-03', time: '9:45', lengthMinutes: 60, now: SAT_NIGHT });
    assert.match(badTime.reason, /7:30PM/);
    const badDay = rules.validateBooking({ day: 'tomorrow', time: '11PM', lengthMinutes: 60, now: SAT_NIGHT });
    assert.match(badDay.reason, /this week/);
    const badLength = rules.validateBooking({ day: '2026-10-03', time: '11PM', lengthMinutes: 45, now: SAT_NIGHT });
    assert.match(badLength.reason, /30, 60, 90 or 120/);
});

test('DST end: a 7PM booking on 2026-11-01 is 01:00Z and the week starts that day', () => {
    const sundayNoon = new Date('2026-11-01T18:00:00Z');
    assert.strictEqual(rules.weekBounds(sundayNoon).start, '2026-11-01');
    const result = rules.validateBooking({ day: '2026-11-01', time: '7PM', lengthMinutes: 60, now: sundayNoon });
    assert.strictEqual(result.startsAt.toISOString(), '2026-11-02T01:00:00.000Z');
});

test('labels read like the calendar', () => {
    const booking = { startsAt: new Date('2026-10-07T00:00:00Z'), endsAt: new Date('2026-10-07T01:00:00Z') };
    assert.strictEqual(rules.slotLabel(booking), 'Tue 10/6 7PM (1 hr)');
    assert.strictEqual(rules.rangeLabel(booking), '7PM-8PM');
    assert.strictEqual(rules.formatTime(new Date('2026-10-07T00:30:00Z')), '7:30PM');
    assert.strictEqual(rules.lengthLabel(90), '1.5 hr');
});

const SLOT = { hostId: 'h1', startsAt: '2026-10-06T00:00:00Z', endsAt: '2026-10-06T01:00:00Z' };
const NOW = new Date('2026-10-06T03:00:00Z');

test('a session inside, or overlapping either edge of, the slot counts as hosted', () => {
    const cases = [
        { startedAt: '2026-10-06T00:05:00Z', endedAt: '2026-10-06T00:50:00Z' },
        { startedAt: '2026-10-05T23:50:00Z', endedAt: '2026-10-06T00:10:00Z' },
        { startedAt: '2026-10-06T00:55:00Z', endedAt: '2026-10-06T02:00:00Z' },
        { startedAt: '2026-10-06T00:30:00Z', endedAt: null },
    ];
    for (const s of cases) {
        assert.strictEqual(rules.resolveStatus(SLOT, [{ hostId: 'h1', ...s }], NOW), 'hosted', JSON.stringify(s));
    }
});

test('one long session covers two consecutive slots', () => {
    const session = { hostId: 'h1', startedAt: '2026-10-05T23:55:00Z', endedAt: '2026-10-06T02:00:00Z' };
    const second = { hostId: 'h1', startsAt: '2026-10-06T01:00:00Z', endsAt: '2026-10-06T02:00:00Z' };
    assert.strictEqual(rules.resolveStatus(SLOT, [session], NOW), 'hosted');
    assert.strictEqual(rules.resolveStatus(second, [session], NOW), 'hosted');
});

test('no session, a session too early, or another host\'s session is a no-show', () => {
    assert.strictEqual(rules.resolveStatus(SLOT, [], NOW), 'no_show');
    const early = { hostId: 'h1', startedAt: '2026-10-05T23:00:00Z', endedAt: '2026-10-05T23:40:00Z' };
    assert.strictEqual(rules.resolveStatus(SLOT, [early], NOW), 'no_show');
    const other = { hostId: 'h2', startedAt: '2026-10-06T00:05:00Z', endedAt: '2026-10-06T00:50:00Z' };
    assert.strictEqual(rules.resolveStatus(SLOT, [other], NOW), 'no_show');
});

test('matching uses host id, so a renamed host still resolves hosted', () => {
    const booking = { ...SLOT, hostUsername: 'old_name' };
    const session = { hostId: 'h1', hostName: 'New Name', startedAt: '2026-10-06T00:05:00Z', endedAt: '2026-10-06T00:50:00Z' };
    assert.strictEqual(rules.resolveStatus(booking, [session], NOW), 'hosted');
});

test('leads are the configured ids plus the bot owner', () => {
    assert.strictEqual(rules.isLead('a', ['a', 'b'], 'z'), true);
    assert.strictEqual(rules.isLead('z', ['a'], 'z'), true);
    assert.strictEqual(rules.isLead('c', ['a'], 'z'), false);
    assert.strictEqual(rules.isLead('c', ['a'], undefined), false);
});
