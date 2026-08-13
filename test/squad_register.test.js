'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { registrationGate } = require('../commands/squads/squad_register');

const own = (name, type) => ({ name, squad_type: type, owner_id: 'me' });
const base = { userId: 'me', squadName: 'ABC', squadType: 'Casual', ownedSquads: [], membership: null, nameHolders: [] };

test('rejects bad names and duplicate types, requires shared name across types', () => {
    assert.strictEqual(registrationGate({ ...base, squadName: 'TOOLONG' }).code, 'BAD_NAME');
    assert.strictEqual(registrationGate({ ...base, squadName: 'ab!' }).code, 'BAD_NAME');
    assert.strictEqual(registrationGate({ ...base, ownedSquads: [own('ABC', 'Casual')] }).code, 'HAS_CASUAL');
    const mismatch = registrationGate({ ...base, squadName: 'XYZ', ownedSquads: [own('ABC', 'Competitive')] });
    assert.strictEqual(mismatch.code, 'NAME_MISMATCH');
    assert.strictEqual(mismatch.expected, 'ABC');
});

test('second competitive squad is refused (B teams closed)', () => {
    assert.strictEqual(
        registrationGate({ ...base, squadName: 'NEW1', squadType: 'Competitive', ownedSquads: [own('ABC', 'Competitive')] }).code,
        'BTEAM_CLOSED'
    );
});

test('competitive must share the casual name', () => {
    assert.strictEqual(
        registrationGate({ ...base, squadName: 'XYZ', squadType: 'Competitive', ownedSquads: [own('ABC', 'Casual')] }).code,
        'NAME_MISMATCH'
    );
});

test('members must leave before creating; names owned by others are taken', () => {
    assert.strictEqual(registrationGate({ ...base, membership: { squad: own('ZZZ', 'Casual') } }).code, 'IN_A_SQUAD');
    assert.strictEqual(registrationGate({ ...base, nameHolders: [{ name: 'ABC', owner_id: 'other' }] }).code, 'NAME_TAKEN');
    assert.strictEqual(
        registrationGate({ ...base, squadType: 'Competitive', ownedSquads: [own('ABC', 'Casual')], nameHolders: [{ name: 'ABC', owner_id: 'me' }] }).ok,
        true
    );
});
