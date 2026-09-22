'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

function installMock(relativePath, mockExports) {
    const modulePath = require.resolve(relativePath);
    require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports: mockExports };
}

const calls = [];
const state = {};

function resetState() {
    calls.length = 0;
    state.standings = [];
    state.claimed = true;
    state.previousWinnerId = null;
    state.roleMemberIds = [];
    state.posts = [];
    state.channelMissing = false;
    state.sendFails = false;
    state.grantFails = false;
    state.roleAboveBot = false;
}
resetState();

installMock('../utils/logger', { info: () => {}, warn: () => {}, error: (...a) => calls.push(['error', a.join(' ')]) });

installMock('../utils/event_winner_queries', {
    listCycleStandings: async (cycle) => { calls.push(['standings', cycle.start, cycle.end]); return state.standings; },
    getPreviousCycleWinnerId: async () => state.previousWinnerId,
    claimCycle: async (args) => {
        calls.push(['claim', args.start, args.winnerId, args.wins]);
        return state.claimed ? { cycleStart: args.start } : null;
    },
});

const { runEventWinnerCycle } = require('../jobs/event-winner-cycle');

const roleRemovals = [];
const roleAdds = [];

// Holding the role is read from the same list the role's member cache reports,
// so the champion genuinely lacks it and the grant path is exercised.
const makeMember = (id) => ({
    id,
    roles: {
        cache: { has: () => state.roleMemberIds.includes(id) },
        remove: async () => { roleRemovals.push(id); },
        add: async () => {
            if (state.grantFails) throw new Error('nope');
            roleAdds.push(id);
        },
    },
});

const clientStub = () => ({
    channels: {
        fetch: async () => (state.channelMissing ? null : {
            isTextBased: () => true,
            send: async (payload) => {
                if (state.sendFails) throw new Error('nope');
                state.posts.push(payload);
            },
        }),
    },
    guilds: {
        fetch: async () => ({
            id: 'guild',
            roles: {
                fetch: async () => ({
                    id: 'role',
                    name: 'Top Event Winner',
                    editable: !state.roleAboveBot,
                    members: { map: (fn) => state.roleMemberIds.map((id) => fn({ id })) },
                }),
            },
            members: { fetch: async (id) => makeMember(id) },
        }),
    },
});

const run = (todayISO) => runEventWinnerCycle(clientStub(), { todayISO });

test('a cycle that has not closed does not even query the standings', async () => {
    resetState();
    assert.strictEqual(await run('2026-09-30'), null);
    assert.strictEqual(calls.length, 0);
});

test('an empty cycle is left unclaimed so it can still be announced if wins land', async () => {
    resetState();
    state.standings = [];
    assert.strictEqual(await run('2026-10-05'), null);
    assert.deepStrictEqual(calls.map((c) => c[0]), ['standings']);
    assert.strictEqual(state.posts.length, 0);
});

test('the top winner is announced and the cycle is claimed', async () => {
    resetState();
    state.standings = [{ userId: '111', userName: 'cented', wins: 3 }, { userId: '222', wins: 1 }];
    const result = await run('2026-10-05');
    assert.strictEqual(result.champion.userId, '111');
    assert.deepStrictEqual(calls.find((c) => c[0] === 'claim'), ['claim', '2026-09-21', '111', 3]);
    assert.strictEqual(state.posts.length, 1);
    assert.match(state.posts[0].content, /<@111>/);
    // Only the listed members may be pinged, so a stray role or everyone in the
    // text cannot turn the post into a mass mention.
    assert.deepStrictEqual(state.posts[0].allowedMentions, { users: ['111', '222'] });
});

// The claim happens before the post, so a retry after a failed send cannot
// announce the same cycle twice.
test('a cycle already claimed posts nothing on a rerun', async () => {
    resetState();
    state.standings = [{ userId: '111', wins: 2 }];
    state.claimed = false;
    assert.strictEqual(await run('2026-10-05'), null);
    assert.strictEqual(state.posts.length, 0);
});

test('the role moves off the previous holder and onto the champion', async () => {
    resetState();
    roleRemovals.length = 0;
    roleAdds.length = 0;
    process.env.TOP_EVENT_WINNER_ROLE_ID = 'role';
    delete require.cache[require.resolve('../config/constants')];
    delete require.cache[require.resolve('../jobs/event-winner-cycle')];
    delete require.cache[require.resolve('../utils/event_winner_cycle')];
    const { runEventWinnerCycle: withRole } = require('../jobs/event-winner-cycle');

    state.standings = [{ userId: 'new', wins: 4 }];
    state.previousWinnerId = 'old';
    state.roleMemberIds = ['old', 'by-hand'];
    await withRole(clientStub(), { todayISO: '2026-10-05' });

    assert.deepStrictEqual(roleRemovals.sort(), ['by-hand', 'old']);
    assert.deepStrictEqual(roleAdds, ['new']);
    delete process.env.TOP_EVENT_WINNER_ROLE_ID;
});

test('a champion who already holds the role is not re-granted it', async () => {
    resetState();
    roleRemovals.length = 0;
    roleAdds.length = 0;
    process.env.TOP_EVENT_WINNER_ROLE_ID = 'role';
    delete require.cache[require.resolve('../config/constants')];
    delete require.cache[require.resolve('../jobs/event-winner-cycle')];
    delete require.cache[require.resolve('../utils/event_winner_cycle')];
    const { runEventWinnerCycle: withRole } = require('../jobs/event-winner-cycle');

    state.standings = [{ userId: 'champ', wins: 5 }];
    state.previousWinnerId = 'champ';
    state.roleMemberIds = ['champ'];
    await withRole(clientStub(), { todayISO: '2026-10-05' });

    assert.deepStrictEqual(roleRemovals, []);
    assert.deepStrictEqual(roleAdds, []);
    delete process.env.TOP_EVENT_WINNER_ROLE_ID;
});

// A missing channel is the one failure worth retrying, so the cycle must stay
// unclaimed rather than being burned on a post that never happened.
test('a missing announcement channel leaves the cycle unclaimed', async () => {
    resetState();
    state.standings = [{ userId: '111', wins: 2 }];
    state.channelMissing = true;
    assert.strictEqual(await run('2026-10-05'), null);
    assert.strictEqual(calls.some((c) => c[0] === 'claim'), false);
});

test('a failed post logs the text in full so it can be sent by hand', async () => {
    resetState();
    state.standings = [{ userId: '111', wins: 2 }];
    state.sendFails = true;
    await run('2026-10-05');
    const logged = calls.find((c) => c[0] === 'error' && c[1].includes('send it manually'));
    assert.ok(logged, 'the announcement text was logged');
    assert.match(logged[1], /<@111>/);
});

// Losing the grant must not also strip the sitting holder: somebody wearing the
// role beats nobody wearing it until the next cycle.
test('a failed grant leaves the previous holder wearing the role', async () => {
    resetState();
    roleRemovals.length = 0;
    roleAdds.length = 0;
    process.env.TOP_EVENT_WINNER_ROLE_ID = 'role';
    delete require.cache[require.resolve('../config/constants')];
    delete require.cache[require.resolve('../jobs/event-winner-cycle')];
    delete require.cache[require.resolve('../utils/event_winner_cycle')];
    const { runEventWinnerCycle: withRole } = require('../jobs/event-winner-cycle');

    state.standings = [{ userId: 'new', wins: 4 }];
    state.previousWinnerId = 'old';
    state.roleMemberIds = ['old'];
    state.grantFails = true;
    await withRole(clientStub(), { todayISO: '2026-10-05' });

    assert.deepStrictEqual(roleAdds, []);
    assert.deepStrictEqual(roleRemovals, []);
    delete process.env.TOP_EVENT_WINNER_ROLE_ID;
});

test('a role the bot cannot manage is reported as a hierarchy problem', async () => {
    resetState();
    roleRemovals.length = 0;
    roleAdds.length = 0;
    process.env.TOP_EVENT_WINNER_ROLE_ID = 'role';
    delete require.cache[require.resolve('../config/constants')];
    delete require.cache[require.resolve('../jobs/event-winner-cycle')];
    delete require.cache[require.resolve('../utils/event_winner_cycle')];
    const { runEventWinnerCycle: withRole } = require('../jobs/event-winner-cycle');

    state.standings = [{ userId: 'new', wins: 4 }];
    state.roleMemberIds = ['old'];
    state.roleAboveBot = true;
    await withRole(clientStub(), { todayISO: '2026-10-05' });

    assert.deepStrictEqual(roleAdds, []);
    assert.deepStrictEqual(roleRemovals, []);
    assert.ok(calls.some((c) => c[0] === 'error' && c[1].includes('above the bot')));
    // The post still goes out: the standings do not depend on the role.
    assert.strictEqual(state.posts.length, 1);
    delete process.env.TOP_EVENT_WINNER_ROLE_ID;
});
