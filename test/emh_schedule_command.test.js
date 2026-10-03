'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const calls = [];
const state = { conflict: null, booking: null, renderFails: false, reschedule: { missing: true }, upcoming: [] };
const stub = (relative, exports) => {
    const file = require.resolve(path.join('..', relative));
    require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
const booking = (overrides = {}) => ({
    id: 5, hostId: 'host-1', hostUsername: 'host_a', status: 'scheduled', statusSource: 'auto',
    startsAt: new Date('2099-01-01T01:00:00Z'), endsAt: new Date('2099-01-01T02:00:00Z'), ...overrides,
});
stub('utils/emh_schedule_queries', {
    createBooking: async (input) => {
        calls.push(['create', input]);
        return state.conflict ? { conflict: state.conflict } : { booking: booking({ ...input, id: 9 }) };
    },
    getBooking: async () => state.booking,
    cancelBooking: async (input) => {
        calls.push(['cancel', input]);
        return { ...state.booking, status: 'cancelled' };
    },
    rescheduleBooking: async (input) => {
        calls.push(['reschedule', input]);
        return state.reschedule;
    },
    listUpcomingBookings: async () => state.upcoming,
    listBookingsBetween: async () => [],
});
stub('utils/emh_schedule_sheet', {
    renderMonthlyView: async () => {
        calls.push(['render']);
        if (state.renderFails) throw new Error('should never surface');
        return true;
    },
});

const { HOST_ROLE_ID, EMH_LEAD_IDS } = require('../config/constants');
const rules = require('../utils/emh_schedule');
const handler = require('../handlers/emh_schedule');

const fakeInteraction = ({ sub, userId = 'host-1', roles = [HOST_ROLE_ID], options = {} }) => {
    const replies = [];
    return {
        replies,
        user: { id: userId, username: userId === 'host-1' ? 'host_a' : 'other_user' },
        member: { roles: { cache: { has: (id) => roles.includes(id) } } },
        options: {
            getSubcommand: () => sub,
            getString: (name) => options[name] ?? null,
            getInteger: (name) => options[name] ?? null,
        },
        replied: false,
        deferred: false,
        reply: async (payload) => {
            replies.push(JSON.stringify(payload));
        },
    };
};

// The last bookable day at 11:59PM is always in the future except during the
// final minute of a Saturday.
const futureSlot = () => ({ day: rules.bookableDays().at(-1).value, time: '11:59PM' });

beforeEach(() => {
    calls.length = 0;
    Object.assign(state, { conflict: null, booking: null, renderFails: false, reschedule: { missing: true }, upcoming: [] });
});

test('a member without the host role cannot book', async () => {
    const interaction = fakeInteraction({ sub: 'schedule', roles: [], options: futureSlot() });
    await handler.execute(interaction);
    assert.match(interaction.replies[0], /Hosts Only/);
    assert.strictEqual(calls.length, 0);
});

test('a host books under their own id and username and the sheet redraws', async () => {
    const interaction = fakeInteraction({ sub: 'schedule', options: futureSlot() });
    await handler.execute(interaction);
    const [, input] = calls.find(([name]) => name === 'create');
    assert.strictEqual(input.hostId, 'host-1');
    assert.strictEqual(input.hostUsername, 'host_a');
    assert.ok(calls.some(([name]) => name === 'render'));
    assert.match(interaction.replies[0], /Slot Booked/);
});

test('a taken time names the host who has it', async () => {
    state.conflict = booking({ hostUsername: 'host_b' });
    const interaction = fakeInteraction({ sub: 'schedule', options: futureSlot() });
    await handler.execute(interaction);
    assert.match(interaction.replies[0], /already booked by host_b/);
});

test('booking succeeds when render fails', async () => {
    state.renderFails = true;
    const interaction = fakeInteraction({ sub: 'schedule', options: futureSlot() });
    await handler.execute(interaction);
    assert.match(interaction.replies[0], /Slot Booked/);
});

test('a host cannot cancel another host\'s slot, even by typing its id', async () => {
    state.booking = booking({ hostId: 'someone-else' });
    const interaction = fakeInteraction({ sub: 'cancel', options: { slot: '5' } });
    await handler.execute(interaction);
    assert.match(interaction.replies[0], /Not Your Slot/);
    assert.strictEqual(calls.some(([name]) => name === 'cancel'), false);
});

test('a lead can cancel any slot', async () => {
    state.booking = booking({ hostId: 'someone-else' });
    const interaction = fakeInteraction({ sub: 'cancel', userId: EMH_LEAD_IDS[0], roles: [], options: { slot: '5' } });
    await handler.execute(interaction);
    assert.match(interaction.replies[0], /Slot Cancelled/);
    assert.strictEqual(calls.find(([name]) => name === 'cancel')[1].cancelledBy, EMH_LEAD_IDS[0]);
});

test('a slot that no longer exists is reported, not crashed on', async () => {
    const interaction = fakeInteraction({ sub: 'cancel', options: { slot: 'abc' } });
    await handler.execute(interaction);
    assert.match(interaction.replies[0], /Slot Not Found/);
});

test('a host cannot move another host\'s slot', async () => {
    state.booking = booking({ hostId: 'someone-else' });
    const interaction = fakeInteraction({ sub: 'reschedule', options: { slot: '5', ...futureSlot() } });
    await handler.execute(interaction);
    assert.match(interaction.replies[0], /Not Your Slot/);
    assert.strictEqual(calls.some(([name]) => name === 'reschedule'), false);
});

test('a reschedule into a taken time names the other host and keeps the original', async () => {
    state.booking = booking();
    state.reschedule = { conflict: booking({ id: 8, hostUsername: 'host_b' }) };
    const interaction = fakeInteraction({ sub: 'reschedule', options: { slot: '5', ...futureSlot() } });
    await handler.execute(interaction);
    assert.match(interaction.replies[0], /already booked by host_b/);
    assert.match(interaction.replies[0], /booking is unchanged/);
    assert.strictEqual(calls.some(([name]) => name === 'render'), false);
});

test('a successful reschedule keeps the slot length by default and redraws', async () => {
    state.booking = booking({ endsAt: new Date('2099-01-01T02:30:00Z') });
    state.reschedule = { booking: booking({ id: 5 }) };
    const interaction = fakeInteraction({ sub: 'reschedule', options: { slot: '5', ...futureSlot() } });
    await handler.execute(interaction);
    const [, input] = calls.find(([name]) => name === 'reschedule');
    assert.strictEqual((input.endsAt - input.startsAt) / 60000, 90);
    assert.ok(calls.some(([name]) => name === 'render'));
    assert.match(interaction.replies[0], /Slot Moved/);
});

test('a host cannot cancel or move a slot that has already started', async () => {
    state.booking = booking({ startsAt: new Date(Date.now() - 10 * 60000), endsAt: new Date(Date.now() + 50 * 60000) });
    for (const sub of ['cancel', 'reschedule']) {
        const interaction = fakeInteraction({ sub, options: { slot: '5', ...futureSlot() } });
        await handler.execute(interaction);
        assert.match(interaction.replies[0], /Already Started/, sub);
    }
    assert.strictEqual(calls.some(([name]) => name === 'cancel' || name === 'reschedule'), false);
});

test('a lead can still fix a slot that has already started', async () => {
    state.booking = booking({ hostId: 'someone-else', startsAt: new Date(Date.now() - 10 * 60000), endsAt: new Date(Date.now() + 50 * 60000) });
    const interaction = fakeInteraction({ sub: 'cancel', userId: EMH_LEAD_IDS[0], roles: [], options: { slot: '5' } });
    await handler.execute(interaction);
    assert.match(interaction.replies[0], /Slot Cancelled/);
});

const autocompleteFor = (userId, focused) => {
    const responses = [];
    return {
        responses,
        user: { id: userId },
        options: { getFocused: () => focused },
        respond: async (choices) => {
            responses.push(choices);
        },
    };
};

test('a lead can find a slot past the first 25 by typing its day', async () => {
    const start = new Date('2099-01-04T15:00:00Z');
    state.upcoming = Array.from({ length: 30 }, (_, i) => booking({
        id: i + 1,
        hostUsername: `host_${i}`,
        startsAt: new Date(start.getTime() + i * 3 * 3600000),
        endsAt: new Date(start.getTime() + (i * 3 + 1) * 3600000),
    }));
    const last = state.upcoming.at(-1);
    const day = rules.dayLabel(last.startsAt).slice(0, 3).toLowerCase();
    const interaction = autocompleteFor(EMH_LEAD_IDS[0], { name: 'slot', value: day });
    await handler.autocomplete(interaction);
    const choices = interaction.responses[0];
    assert.ok(choices.length <= 25);
    assert.ok(choices.some((choice) => choice.value === String(last.id)), 'last slot reachable');
    assert.ok(choices.every((choice) => choice.name.toLowerCase().includes(day)));
});
