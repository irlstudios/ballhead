'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { findABPair } = require('../commands/squads/squad_promote');

test('findABPair links B to A via parent_squad_id', () => {
    const a = { id: 1, name: 'AAA', squad_type: 'Competitive', parent_squad_id: null };
    const b = { id: 2, name: 'BBB', squad_type: 'Competitive', parent_squad_id: 1 };
    assert.deepStrictEqual(findABPair([a, b]), { aTeam: a, bTeam: b });
    assert.strictEqual(findABPair([a]), null);
    assert.strictEqual(findABPair([]), null);
    // A dangling parent link (A team gone) is not a pair.
    assert.strictEqual(findABPair([b]), null);
});
