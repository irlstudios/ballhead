'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { buildRosterLines } = require('../commands/squads/squad_roster');

test('roster shows owner, members with join dates, and no wins or levels', () => {
    const lines = buildRosterLines(
        { name: 'ABC', squad_type: 'Competitive', owner_id: '1', owner_username: 'cap', created_at: new Date('2025-01-02') },
        [{ user_id: '2', username: 'mate', joined_at: new Date('2025-02-03') }]
    );
    const text = lines.join('\n');
    assert.match(text, /<@1>/);
    assert.match(text, /mate/);
    assert.match(text, /2025-02-03/);
    assert.match(text, /2\/10/);
    assert.ok(!/win|level/i.test(text));
});

test('roster handles an empty squad and missing dates', () => {
    const lines = buildRosterLines(
        { name: 'ABC', squad_type: 'Casual', owner_id: '1', owner_username: null, created_at: null },
        []
    );
    const text = lines.join('\n');
    assert.match(text, /1\/10/);
    assert.match(text, /No members yet/);
});
