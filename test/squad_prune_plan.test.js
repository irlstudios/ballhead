'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { planSquadCleanup } = require('../utils/squad_prune');

test('ownerless squads disband; departed members prune from surviving squads', () => {
    const squads = [
        { id: 1, name: 'GONE', owner_id: 'left' },
        { id: 2, name: 'HERE', owner_id: 'stays' },
    ];
    const plan = planSquadCleanup({
        squads,
        membersBySquadId: { 1: [{ user_id: 'x' }], 2: [{ user_id: 'stays2' }, { user_id: 'left2' }] },
        guildMemberIds: new Set(['stays', 'stays2', 'x']),
    });
    assert.deepStrictEqual(plan.disband.map((s) => s.id), [1]);
    assert.deepStrictEqual(plan.prune, [{ squad: squads[1], member: { user_id: 'left2' } }]);
});

test('member pruning is skipped for squads that will be disbanded', () => {
    const squads = [{ id: 1, name: 'GONE', owner_id: 'left' }];
    const plan = planSquadCleanup({
        squads,
        membersBySquadId: { 1: [{ user_id: 'also-left' }] },
        guildMemberIds: new Set([]),
    });
    assert.deepStrictEqual(plan.disband.map((s) => s.id), [1]);
    assert.deepStrictEqual(plan.prune, []);
});

test('a squad with no departed members produces no work', () => {
    const squads = [{ id: 1, name: 'OK', owner_id: 'a' }];
    const plan = planSquadCleanup({
        squads,
        membersBySquadId: { 1: [{ user_id: 'b' }] },
        guildMemberIds: new Set(['a', 'b']),
    });
    assert.deepStrictEqual(plan.disband, []);
    assert.deepStrictEqual(plan.prune, []);
});
