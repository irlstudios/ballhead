'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { inviteGate } = require('../commands/squads/squad_invite');
const { disambiguateOwnedSquad } = require('../utils/squad_db');

const base = { inviter: 'a', target: 'b', targetIsBot: false, targetInGuild: true, targetMembership: null, targetOwnedSquads: [], optIn: true, memberCount: 0 };

test('invite gate covers every refusal in order', () => {
    assert.strictEqual(inviteGate({ ...base, target: 'a' }).code, 'SELF');
    assert.strictEqual(inviteGate({ ...base, targetIsBot: true }).code, 'BOT');
    assert.strictEqual(inviteGate({ ...base, targetInGuild: false }).code, 'NOT_IN_GUILD');
    assert.strictEqual(inviteGate({ ...base, targetOwnedSquads: [{ id: 1 }] }).code, 'TARGET_LEADS');
    assert.strictEqual(inviteGate({ ...base, targetMembership: { squad: { id: 2, name: 'ZZZ' } } }).code, 'TARGET_IN_SQUAD');
    assert.strictEqual(inviteGate({ ...base, optIn: false }).code, 'OPTED_OUT');
    assert.strictEqual(inviteGate({ ...base, memberCount: 9 }).code, 'FULL');
    assert.strictEqual(inviteGate(base).ok, true);
});

test('disambiguateOwnedSquad merges a Casual+Competitive pair, preferring Competitive', () => {
    const casual = { id: 1, name: 'ABC', squad_type: 'Casual' };
    const comp = { id: 2, name: 'ABC', squad_type: 'Competitive' };
    assert.strictEqual(disambiguateOwnedSquad([casual, comp], null).squad, comp);
    assert.strictEqual(disambiguateOwnedSquad([], null).error, 'You do not own any squads.');
    const two = [{ id: 1, name: 'ABC', squad_type: 'Casual' }, { id: 3, name: 'XYZ', squad_type: 'Competitive' }];
    assert.match(disambiguateOwnedSquad(two, null).error, /specify which squad/);
    assert.strictEqual(disambiguateOwnedSquad(two, 'xyz').squad.id, 3);
    assert.match(disambiguateOwnedSquad(two, 'NOPE').error, /do not own a squad named/);
});
