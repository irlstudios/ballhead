'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { resolveModPingDmTargets } = require('../utils/mod_ping_logic');

const HELPER = '939634611909185646';
const DEV = '805833778064130104';

test('DMs a subscriber of a pinged role they do not hold', () => {
    const targets = resolveModPingDmTargets({
        pingedRoleIds: [HELPER],
        subscriptions: [{ user_id: 'mod1', role_id: HELPER }],
        authorId: 'author',
        heldRoleIdsByUserId: new Map([['mod1', new Set([DEV])]]),
    });
    assert.deepStrictEqual([...targets], [['mod1', [HELPER]]]);
});

test('never DMs the message author', () => {
    const targets = resolveModPingDmTargets({
        pingedRoleIds: [HELPER],
        subscriptions: [{ user_id: 'author', role_id: HELPER }],
        authorId: 'author',
        heldRoleIdsByUserId: new Map(),
    });
    assert.strictEqual(targets.size, 0);
});

test('skips pinged roles the subscriber holds, keeps ones they do not', () => {
    const targets = resolveModPingDmTargets({
        pingedRoleIds: [HELPER, DEV],
        subscriptions: [
            { user_id: 'mod1', role_id: HELPER },
            { user_id: 'mod1', role_id: DEV },
        ],
        authorId: 'author',
        heldRoleIdsByUserId: new Map([['mod1', new Set([DEV])]]),
    });
    assert.deepStrictEqual([...targets], [['mod1', [HELPER]]]);
});

test('ignores subscriptions to roles that were not pinged', () => {
    const targets = resolveModPingDmTargets({
        pingedRoleIds: [HELPER],
        subscriptions: [{ user_id: 'mod1', role_id: DEV }],
        authorId: 'author',
        heldRoleIdsByUserId: new Map(),
    });
    assert.strictEqual(targets.size, 0);
});

test('subscriber with no held-roles entry is still targeted', () => {
    const targets = resolveModPingDmTargets({
        pingedRoleIds: [HELPER],
        subscriptions: [{ user_id: 'mod1', role_id: HELPER }],
        authorId: 'author',
        heldRoleIdsByUserId: new Map(),
    });
    assert.deepStrictEqual([...targets], [['mod1', [HELPER]]]);
});
