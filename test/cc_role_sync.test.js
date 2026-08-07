'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
    CC_ROLE_IDS,
    PLATFORM_CC_ROLE_IDS,
    parseCreatorRows,
    desiredRoleIdsFor,
    buildSyncPlan,
} = require('../utils/cc_role_sync');

const { CONTENT_CREATORS, CONTENT_CREATORS_REELS, ACTIVE_REELS } = CC_ROLE_IDS;

test('role ids match the live guild roles', () => {
    assert.strictEqual(CONTENT_CREATORS, '879910773831372811');
    assert.strictEqual(CONTENT_CREATORS_REELS, '1130621784677421096');
    assert.strictEqual(ACTIVE_REELS, '1202469981724483584');
});

test('base creators get the two content creator roles only', () => {
    assert.deepStrictEqual(
        [...desiredRoleIdsFor('Base')].sort(),
        [CONTENT_CREATORS, CONTENT_CREATORS_REELS].sort()
    );
});

test('active, sponsored, and alumni creators also get Active Reels', () => {
    for (const status of ['Active', 'Sponsored', 'Sponsored Alumni', 'Alumni', 'active ']) {
        assert.deepStrictEqual(
            [...desiredRoleIdsFor(status)].sort(),
            [CONTENT_CREATORS, CONTENT_CREATORS_REELS, ACTIVE_REELS].sort(),
            `status "${status}" should grant all three roles`
        );
    }
});

test('unknown or empty status is treated like Base (never grants Active Reels)', () => {
    for (const status of ['', undefined, 'Something New']) {
        const roles = desiredRoleIdsFor(status);
        assert.ok(!roles.has(ACTIVE_REELS), `status "${status}" must not grant Active Reels`);
        assert.ok(roles.has(CONTENT_CREATORS));
    }
});

test('parseCreatorRows skips the header and rows without a discord snowflake', () => {
    const rows = [
        ['Platform', 'Status', 'Username', 'DD ID', 'P ID'],
        ['Reels', 'Base', 'irlnozer', '1007294036245237810', '75787331976'],
        ['Reels', 'Active', 'nobody', '', '123'],
        ['Reels', 'Active', 'baddid', 'not-a-snowflake', '123'],
        ['Reels', 'Sponsored', 'wish_kxnzo', '1026338319723933767', '80011884853'],
    ];
    const creators = parseCreatorRows(rows);
    assert.deepStrictEqual(creators, [
        { ddId: '1007294036245237810', status: 'Base', username: 'irlnozer' },
        { ddId: '1026338319723933767', status: 'Sponsored', username: 'wish_kxnzo' },
    ]);
});

test('buildSyncPlan adds missing roles, removes stale holders, leaves correct ones alone', () => {
    const creators = [
        { ddId: '1', status: 'Active', username: 'a' },   // should hold all 3
        { ddId: '2', status: 'Base', username: 'b' },     // should hold CC + CC Reels
    ];
    const currentMembersByRole = {
        [CONTENT_CREATORS]: ['1', '9'],          // 9 is stale
        [CONTENT_CREATORS_REELS]: ['2'],         // 1 is missing
        [ACTIVE_REELS]: ['2'],                   // base creator wrongly active, 1 missing
    };
    const plan = buildSyncPlan(creators, currentMembersByRole);

    assert.deepStrictEqual(plan.add[CONTENT_CREATORS], ['2']);
    assert.deepStrictEqual(plan.remove[CONTENT_CREATORS], ['9']);
    assert.deepStrictEqual(plan.add[CONTENT_CREATORS_REELS], ['1']);
    assert.deepStrictEqual(plan.remove[CONTENT_CREATORS_REELS], []);
    assert.deepStrictEqual(plan.add[ACTIVE_REELS], ['1']);
    assert.deepStrictEqual(plan.remove[ACTIVE_REELS], ['2']);
});

test('platform CC role ids cover tiktok and youtube creators', () => {
    assert.deepStrictEqual(
        [...PLATFORM_CC_ROLE_IDS].sort(),
        ['1202470065535062036', '952651266658553946']
    );
});

test('tiktok/youtube creators keep and gain the umbrella Content Creators role', () => {
    const creators = [{ ddId: '1', status: 'Base', username: 'a' }];
    const currentMembersByRole = {
        [CONTENT_CREATORS]: ['5'],               // 5 holds umbrella via tiktok: keep
        [CONTENT_CREATORS_REELS]: [],
        [ACTIVE_REELS]: [],
    };
    // 5 holds the tiktok role, 6 holds the youtube role but lacks the umbrella
    const plan = buildSyncPlan(creators, currentMembersByRole, ['5', '6']);

    assert.deepStrictEqual(plan.add[CONTENT_CREATORS].sort(), ['1', '6']);
    assert.deepStrictEqual(plan.remove[CONTENT_CREATORS], []);
    // the other two roles stay sheet-driven only
    assert.deepStrictEqual(plan.add[CONTENT_CREATORS_REELS], ['1']);
    assert.deepStrictEqual(plan.add[ACTIVE_REELS], []);
});

test('buildSyncPlan dedupes creators listed twice in the sheet', () => {
    const creators = [
        { ddId: '1', status: 'Base', username: 'a' },
        { ddId: '1', status: 'Active', username: 'a' },
    ];
    const plan = buildSyncPlan(creators, {
        [CONTENT_CREATORS]: [],
        [CONTENT_CREATORS_REELS]: [],
        [ACTIVE_REELS]: [],
    });
    assert.deepStrictEqual(plan.add[CONTENT_CREATORS], ['1']);
    // any row granting Active Reels wins over a Base duplicate
    assert.deepStrictEqual(plan.add[ACTIVE_REELS], ['1']);
});
