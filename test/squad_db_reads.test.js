'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const capturedQueries = [];
const state = { rows: [] };
const pg = require('pg');
pg.Pool.prototype.connect = async function connect() {
    return {
        query: async (text, params) => {
            capturedQueries.push({ text: String(text), params });
            return { rows: state.rows, rowCount: state.rows.length };
        },
        release: () => {},
    };
};

const squadDb = require('../utils/squad_db');
const lastQuery = () => capturedQueries[capturedQueries.length - 1];

test('fetchSquadByNameAndType matches the uppercased name', async () => {
    state.rows = [];
    const row = await squadDb.fetchSquadByNameAndType('abc', 'Casual');
    assert.strictEqual(row, null);
    assert.deepStrictEqual(lastQuery().params, ['ABC', 'Casual']);
});

test('fetchMembership joins squads and returns null when absent', async () => {
    state.rows = [];
    const result = await squadDb.fetchMembership('user-1');
    assert.strictEqual(result, null);
    assert.match(lastQuery().text, /JOIN squads/i);
});

test('fetchMembership splits squad and member fields', async () => {
    state.rows = [{
        id: 4, name: 'ABC', squad_type: 'Casual', owner_id: '9',
        member_user_id: 'user-1', member_username: 'mate', joined_at: 'then',
    }];
    const result = await squadDb.fetchMembership('user-1');
    assert.strictEqual(result.squad.name, 'ABC');
    assert.deepStrictEqual(result.member, { user_id: 'user-1', username: 'mate', joined_at: 'then' });
    assert.strictEqual(result.squad.member_user_id, undefined);
});

test('fetchOpenSquadsWithSpace filters open squads under capacity and excludes the Casual half of a pair', async () => {
    state.rows = [];
    await squadDb.fetchOpenSquadsWithSpace();
    assert.match(lastQuery().text, /open_squad/);
    assert.match(lastQuery().text, /HAVING COUNT/i);
    assert.match(lastQuery().text, /NOT EXISTS/i);
    assert.deepStrictEqual(lastQuery().params, [squadDb.MAX_SQUAD_MEMBERS - 1]);
});

test('getInvitesOptIn defaults to true with no row', async () => {
    state.rows = [];
    assert.strictEqual(await squadDb.getInvitesOptIn('user-1'), true);
    state.rows = [{ invites_opt_in: false }];
    assert.strictEqual(await squadDb.getInvitesOptIn('user-1'), false);
});

test('normalizeSquadName trims and uppercases', () => {
    assert.strictEqual(squadDb.normalizeSquadName('  abc '), 'ABC');
    assert.strictEqual(squadDb.normalizeSquadName(null), '');
});
