'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { pickRandomSquad } = require('../commands/squads/squad_join');
const { removalGate } = require('../commands/squads/squad_remove_member');

test('pickRandomSquad returns null for an empty pool and a member of the pool otherwise', () => {
    assert.strictEqual(pickRandomSquad([]), null);
    assert.strictEqual(pickRandomSquad(null), null);
    const pool = [{ id: 1 }, { id: 2 }];
    assert.ok(pool.includes(pickRandomSquad(pool)));
});

test('removalGate: owners cannot remove themselves; target must be in that squad', () => {
    assert.strictEqual(removalGate({ ownerId: 'a', targetId: 'a', targetMembership: null, squadId: 1 }).code, 'SELF');
    assert.strictEqual(removalGate({ ownerId: 'a', targetId: 'b', targetMembership: null, squadId: 1 }).code, 'NOT_IN_SQUAD');
    assert.strictEqual(removalGate({ ownerId: 'a', targetId: 'b', targetMembership: { squad: { id: 2 } }, squadId: 1 }).code, 'NOT_IN_SQUAD');
    assert.strictEqual(removalGate({ ownerId: 'a', targetId: 'b', targetMembership: { squad: { id: 1 } }, squadId: 1 }).ok, true);
});
