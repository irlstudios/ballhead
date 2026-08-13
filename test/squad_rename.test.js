'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { renameGate } = require('../commands/squads/squad_change_name');

const squad = { id: 1, name: 'OLD', owner_id: 'me' };

test('rename gate', () => {
    assert.strictEqual(renameGate({ userId: 'me', newName: 'TOOLONG', targetSquad: squad, nameHolders: [] }).code, 'BAD_NAME');
    assert.strictEqual(renameGate({ userId: 'me', newName: 'OLD', targetSquad: squad, nameHolders: [] }).code, 'SAME_NAME');
    assert.strictEqual(renameGate({ userId: 'me', newName: 'NEW1', targetSquad: squad, nameHolders: [{ owner_id: 'other' }] }).code, 'NAME_TAKEN');
    assert.strictEqual(renameGate({ userId: 'me', newName: 'NEW1', targetSquad: squad, nameHolders: [{ owner_id: 'me' }] }).ok, true);
    assert.strictEqual(renameGate({ userId: 'me', newName: 'NEW1', targetSquad: squad, nameHolders: [] }).ok, true);
});
