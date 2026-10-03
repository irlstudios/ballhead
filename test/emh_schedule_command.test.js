'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const calls = [];
const state = { conflict: null, booking: null, renderFails: false };
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
    rescheduleBooking: async () => ({ missing: true }),
    listUpcomingBookings: async () => [],
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
    Object.assign(state, { conflict: null, booking: null, renderFails: false });
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
