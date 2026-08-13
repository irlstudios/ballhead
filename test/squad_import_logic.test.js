'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { planImport, parseSheetDate } = require('../utils/squad_import_logic');

test('parseSheetDate reads MM/DD/YY as a UTC date and rejects garbage', () => {
    assert.strictEqual(parseSheetDate('08/13/26').toISOString().slice(0, 10), '2026-08-13');
    assert.strictEqual(parseSheetDate('not a date'), null);
    assert.strictEqual(parseSheetDate(''), null);
    assert.strictEqual(parseSheetDate(undefined), null);
});

test('planImport builds squads from leaders joined with All Data types', () => {
    const plan = planImport({
        squadLeaders: [
            ['owner', '111', 'ABC', 'N/A', 'TRUE', '01/02/25', ''],
            ['owner2', '222', 'XYZ', 'Dragons', 'FALSE', '03/04/25', 'ABC'],
        ],
        allData: [
            ['owner', '111', 'ABC', 'Competitive', 'N/A', 'FALSE', 'Yes', 'TRUE'],
            ['owner2', '222', 'XYZ', 'Competitive', 'Dragons', 'FALSE', 'Yes', 'FALSE'],
            ['member', '333', 'ABC', 'Competitive', 'N/A', 'FALSE', 'No', 'FALSE'],
        ],
        squadMembers: [
            ['member', '333', 'ABC', 'N/A', '02/03/25'],
        ],
    });
    assert.strictEqual(plan.squads.length, 2);
    const abc = plan.squads.find((s) => s.name === 'ABC');
    assert.strictEqual(abc.squadType, 'Competitive');
    assert.strictEqual(abc.openSquad, true);
    assert.strictEqual(abc.eventSquad, null);
    assert.strictEqual(abc.createdAt.toISOString().slice(0, 10), '2025-01-02');
    const xyz = plan.squads.find((s) => s.name === 'XYZ');
    assert.strictEqual(xyz.parentName, 'ABC');
    assert.strictEqual(xyz.eventSquad, 'Dragons');
    assert.strictEqual(plan.members.length, 1);
    assert.strictEqual(plan.members[0].squadName, 'ABC');
    assert.strictEqual(plan.members[0].userId, '333');
    assert.deepStrictEqual(plan.optOuts, ['222', '333']);
    assert.deepStrictEqual(plan.anomalies, []);
});

test('planImport reports unresolvable squad types as anomalies and defaults Casual', () => {
    const plan = planImport({
        squadLeaders: [['owner', '111', 'ABC', 'N/A', 'FALSE', '01/02/25', '']],
        allData: [],
        squadMembers: [],
    });
    assert.strictEqual(plan.squads[0].squadType, 'Casual');
    assert.strictEqual(plan.anomalies.length, 1);
});

test('planImport imports a Casual+Competitive pair as its two real types', () => {
    const plan = planImport({
        squadLeaders: [
            ['owner', '111', 'ABC', 'N/A', 'FALSE', '01/02/25', ''],
            ['owner', '111', 'ABC', 'N/A', 'FALSE', '01/02/25', ''],
        ],
        allData: [
            ['owner', '111', 'ABC', 'Casual', 'N/A', 'FALSE', 'Yes', 'TRUE'],
            ['owner', '111', 'ABC', 'Competitive', 'N/A', 'FALSE', 'Yes', 'TRUE'],
        ],
        squadMembers: [],
    });
    assert.deepStrictEqual(plan.squads.map((s) => s.squadType).sort(), ['Casual', 'Competitive']);
    assert.deepStrictEqual(plan.anomalies, []);
});

test('planImport skips hole rows, orphan members, and duplicate (name,type) rows', () => {
    const plan = planImport({
        squadLeaders: [
            [],
            ['owner', '111', 'ABC', 'N/A', 'FALSE', '01/02/25', ''],
            ['owner9', '999', 'ABC', 'N/A', 'FALSE', '02/02/25', ''],
        ],
        allData: [
            ['owner', '111', 'ABC', 'Casual', 'N/A', 'FALSE', 'Yes', 'TRUE'],
            ['owner9', '999', 'ABC', 'Casual', 'N/A', 'FALSE', 'Yes', 'TRUE'],
        ],
        squadMembers: [
            ['ghost', '444', 'NOPE', 'N/A', '02/03/25'],
        ],
    });
    assert.strictEqual(plan.squads.length, 1);
    assert.strictEqual(plan.squads[0].ownerId, '111');
    assert.strictEqual(plan.members.length, 0);
    assert.strictEqual(plan.anomalies.length, 2); // duplicate leader row + orphan member
});
