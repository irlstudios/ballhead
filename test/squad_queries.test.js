'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildSquadMemberChoices,
    findAllDataRow,
    findLeaderRow,
    findMemberRowIndex,
    findSquadMembers,
    disambiguateSquad,
    parseDiscordUserId,
    resolveOwnedSquadForMember,
    resolveSquadType,
} = require('../utils/squad_queries');

test('squad lookups normalize IDs, casing, and surrounding whitespace', () => {
    const leaders = [['owner', ' 123 ', ' abc ']];
    const allData = [['owner', ' 123 ', ' AbC ', 'Competitive']];
    const members = [
        ['member one', '456', 'ABC'],
        ['member two', '789', ' abc '],
    ];

    assert.equal(findLeaderRow(leaders, '123', 'ABC'), leaders[0]);
    assert.equal(findAllDataRow(allData, '123', 'abc'), allData[0]);
    assert.deepEqual(findSquadMembers(members, 'AbC'), members);
});

test('resolveSquadType prefers the matching owner row', () => {
    const allData = [
        ['owner', '123', 'ABC', 'Casual'],
        ['member', '456', 'ABC', 'Competitive'],
    ];

    assert.deepEqual(resolveSquadType(allData, '123', 'abc'), {
        squadType: 'Casual',
        source: 'owner-row',
    });
});

test('resolveSquadType falls back to a single squad-wide type', () => {
    const allData = [
        ['member one', '456', 'ES', 'Competitive'],
        ['member two', '789', ' es ', 'Competitive'],
    ];

    assert.deepEqual(resolveSquadType(allData, '123', 'ES'), {
        squadType: 'Competitive',
        source: 'squad-row',
    });
});

test('resolveSquadType refuses conflicting sheet types', () => {
    const allData = [
        ['member one', '456', 'ABC', 'Casual'],
        ['member two', '789', 'ABC', 'Competitive'],
    ];

    assert.deepEqual(
        resolveSquadType(allData, '123', 'ABC', { hasCompetitiveOwnerRole: true }),
        { squadType: null, source: 'conflicting-squad-rows' }
    );
});

test('resolveSquadType uses the owner role only when the sheet has no type evidence', () => {
    assert.deepEqual(resolveSquadType([], '123', 'ABC', { hasCompetitiveOwnerRole: true }), {
        squadType: 'Competitive',
        source: 'owner-role',
    });
    assert.deepEqual(resolveSquadType([], '123', 'ABC', { hasCompetitiveOwnerRole: false }), {
        squadType: 'Casual',
        source: 'owner-role',
    });
});

test('resolveSquadType recovers a legacy Content squad from an accepted application', () => {
    const applicationRows = [
        ['owner', '123', '202', 'Content', 'https://example.test/application', 'Accepted'],
    ];

    assert.deepEqual(resolveSquadType([], '123', '202', {
        applicationRows,
        hasCompetitiveOwnerRole: false,
    }), {
        squadType: 'Content',
        source: 'accepted-application',
    });
});

test('disambiguateSquad ignores duplicate leader rows for the same squad tag', () => {
    const firstRow = ['owner', '123', 'SNG'];
    const duplicateRow = ['owner', '123', 'sng'];

    assert.deepEqual(disambiguateSquad([firstRow, duplicateRow], '123'), {
        squad: duplicateRow,
        error: null,
    });
});

test('resolveOwnedSquadForMember infers the only owned squad containing the member', () => {
    const leaders = [
        ['owner', '123', 'ALPHA'],
        ['owner', '123', 'BETA'],
    ];
    const members = [
        ['member', '456', 'BETA'],
    ];

    assert.deepEqual(resolveOwnedSquadForMember(leaders, members, '123', '456'), {
        squad: leaders[1],
        error: null,
    });
});

test('resolveOwnedSquadForMember requires a squad only when the member appears in multiple owned squads', () => {
    const leaders = [
        ['owner', '123', 'ALPHA'],
        ['owner', '123', 'BETA'],
    ];
    const members = [
        ['member', '456', 'ALPHA'],
        ['member', '456', 'BETA'],
    ];

    const result = resolveOwnedSquadForMember(leaders, members, '123', '456');
    assert.equal(result.squad, null);
    assert.match(result.error, /appears in multiple squads/i);
});

test('parseDiscordUserId accepts raw IDs and mentions but rejects malformed input', () => {
    const userId = '123456789012345678';

    assert.equal(parseDiscordUserId(userId), userId);
    assert.equal(parseDiscordUserId(`<@${userId}>`), userId);
    assert.equal(parseDiscordUserId(`<@!${userId}>`), userId);
    assert.equal(parseDiscordUserId(`${userId}>`), null);
    assert.equal(parseDiscordUserId(`<@${userId}`), null);
    assert.equal(parseDiscordUserId('departed member'), null);
});

test('findMemberRowIndex normalizes stored IDs and squad names', () => {
    const members = [
        ['Departed Player', ' 123456789012345678 ', ' alpha '],
        ['Other Player', '234567890123456789', 'BETA'],
    ];

    assert.equal(findMemberRowIndex(members, '123456789012345678', 'ALPHA'), 0);
    assert.equal(findMemberRowIndex(members, '123456789012345678', 'BETA'), -1);
});

test('buildSquadMemberChoices uses stored members without requiring guild membership', () => {
    const departedId = '123456789012345678';
    const currentId = '234567890123456789';
    const otherSquadId = '345678901234567890';
    const members = [
        ['Departed Player', departedId, 'Alpha'],
        ['Current Player', currentId, ' alpha '],
        ['Duplicate Row', currentId, 'ALPHA'],
        ['Other Squad', otherSquadId, 'Beta'],
        ['Corrupt ID', 'not-an-id', 'Alpha'],
    ];

    assert.deepEqual(buildSquadMemberChoices(members, ['ALPHA']), [
        { name: 'Departed Player — Alpha', value: departedId },
        { name: 'Current Player — alpha', value: currentId },
    ]);
    assert.deepEqual(buildSquadMemberChoices(members, ['Alpha'], 'departed'), [
        { name: 'Departed Player — Alpha', value: departedId },
    ]);
    assert.deepEqual(buildSquadMemberChoices(members, ['Alpha'], currentId), [
        { name: 'Current Player — alpha', value: currentId },
    ]);
});
