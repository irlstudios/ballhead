'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    disbandDepartedOwnerSquad,
    planSquadMembershipCleanup,
} = require('../utils/squad_prune');

test('cleanup plan disbands only squads whose every recorded owner left', () => {
    const leaders = [
        ['gone owner', 'owner-gone', 'OLD'],
        ['active owner', 'owner-active', 'LIVE'],
        ['stale co-owner', 'co-owner-gone', 'MIX'],
        ['active co-owner', 'co-owner-active', 'MIX'],
    ];
    const members = [];
    const guildMemberIds = new Set(['owner-active', 'co-owner-active']);

    const plan = planSquadMembershipCleanup(leaders, members, guildMemberIds);

    assert.deepEqual(plan.departedOwnerSquads, [{
        squadKey: 'OLD',
        squadName: 'OLD',
        ownerIds: ['owner-gone'],
    }]);
});

test('cleanup plan skips member pruning for squads that will be disbanded', () => {
    const leaders = [
        ['gone owner', 'owner-gone', 'OLD'],
        ['active owner', 'owner-active', 'LIVE'],
    ];
    const members = [
        ['gone from old', 'member-old', 'OLD'],
        ['gone from live', 'member-live', 'LIVE'],
        ['duplicate gone from live', 'member-live', ' live '],
        ['active member', 'member-active', 'LIVE'],
        ['orphaned squad member', 'member-orphan', 'NONE'],
    ];
    const guildMemberIds = new Set(['owner-active', 'member-active']);

    const plan = planSquadMembershipCleanup(leaders, members, guildMemberIds);

    assert.deepEqual(
        plan.departedMembersBySquad.map(group => ({
            squadKey: group.squadKey,
            memberIds: group.members.map(member => member.userId),
        })),
        [
            { squadKey: 'LIVE', memberIds: ['member-live'] },
            { squadKey: 'NONE', memberIds: ['member-orphan'] },
        ]
    );
});

test('cleanup plan does not disband malformed leader rows without an owner ID', () => {
    const plan = planSquadMembershipCleanup(
        [['unknown owner', '', 'UNKNOWN']],
        [],
        new Set()
    );

    assert.deepEqual(plan.departedOwnerSquads, []);
});

function buildSheetsMock() {
    const calls = {
        clear: [],
        update: [],
    };
    const sheets = {
        spreadsheets: {
            values: {
                async batchGet() {
                    return {
                        data: {
                            valueRanges: [
                                {
                                    values: [
                                        ['Username', 'ID', 'Squad', 'Event Squad', 'Joined'],
                                        ['member', 'member-active', 'LIVE', 'N/A', '01/01/26'],
                                        ['other member', 'member-other', 'OTHER', 'N/A', '01/01/26'],
                                    ],
                                },
                                {
                                    values: [
                                        ['Username', 'ID', 'Squad', 'Event Squad', 'Open', 'Made', 'Parent'],
                                        ['owner', 'owner-gone', 'LIVE', 'N/A', 'FALSE', '01/01/26', ''],
                                        ['other owner', 'owner-other', 'OTHER', 'N/A', 'FALSE', '01/01/26', ''],
                                    ],
                                },
                                {
                                    values: [
                                        ['Username', 'ID', 'Squad', 'Type', 'Event', 'Open', 'Leader', 'Preference'],
                                        ['owner', 'owner-gone', 'LIVE', 'Competitive', 'N/A', 'FALSE', 'Yes', 'TRUE'],
                                        ['member', 'member-active', 'LIVE', 'Competitive', 'N/A', 'FALSE', 'No', 'FALSE'],
                                        ['other', 'owner-other', 'OTHER', 'Casual', 'N/A', 'FALSE', 'Yes', 'TRUE'],
                                    ],
                                },
                            ],
                        },
                    };
                },
                async batchClear(options) {
                    calls.clear.push(options);
                },
                async batchUpdate(options) {
                    calls.update.push(options);
                },
            },
        },
    };
    return { calls, sheets };
}

test('owner departure disbands the squad with targeted sheet mutations', async () => {
    const { calls, sheets } = buildSheetsMock();
    let dmCount = 0;
    const member = {
        id: 'member-active',
        nickname: null,
        roles: {
            cache: { has: () => false },
            remove: async () => {},
        },
        async send() {
            dmCount += 1;
        },
    };

    const result = await disbandDepartedOwnerSquad(
        sheets,
        'live',
        new Set(['member-active', 'owner-other']),
        new Map([['member-active', member]])
    );

    assert.equal(result.disbanded, true);
    assert.equal(result.squadType, 'Competitive');
    assert.equal(dmCount, 1);
    assert.deepEqual(calls.clear[0].resource.ranges, [
        'Squad Members!A2:E2',
        'Squad Leaders!A2:G2',
    ]);
    assert.deepEqual(
        calls.update[0].resource.data.map(update => update.range),
        ['All Data!C2:G2', 'All Data!C3:G3']
    );
});

test('fresh owner recheck prevents disbanding a squad with an active owner', async () => {
    const { calls, sheets } = buildSheetsMock();

    const result = await disbandDepartedOwnerSquad(
        sheets,
        'LIVE',
        new Set(['owner-gone']),
        new Map()
    );

    assert.deepEqual(result, {
        disbanded: false,
        reason: 'active-owner',
        squadName: 'LIVE',
    });
    assert.equal(calls.clear.length, 0);
    assert.equal(calls.update.length, 0);
});
