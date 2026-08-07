'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

// Capture every SQL statement db.js sends to Postgres by stubbing the pg Pool
// before db.js is required (the pool is created at module load time).
const capturedQueries = [];

const pg = require('pg');
pg.Pool.prototype.connect = async function connect() {
    return {
        query: async (text, params) => {
            capturedQueries.push({ text, params });
            return { rows: [], rowCount: 0 };
        },
        release: () => {},
    };
};

const {
    findActiveLeagueByName,
    insertLeagueCreationBlock,
    findLeagueCreationBlock,
} = require('../db');

const lastQuery = () => capturedQueries[capturedQueries.length - 1];

// Force-disband looks a league up by name; it must never match a disbanded
// league (a dead league can shadow a live one that reused the name) and must
// never fuzzy-match, since the result is destroyed.
test('findActiveLeagueByName excludes disbanded leagues and matches exactly', async () => {
    await findActiveLeagueByName('Some League');
    const { text, params } = lastQuery();
    assert.ok(/league_status\s*<>\s*'Disbanded'/i.test(text), `query should exclude disbanded: ${text}`);
    assert.ok(!text.includes('%') && !/ILIKE/i.test(text), `query should not fuzzy-match: ${text}`);
    assert.deepStrictEqual(params, ['Some League']);
});

// The block is keyed by user, and re-blocking the same user must not throw:
// the latest reason/moderator wins.
test('insertLeagueCreationBlock upserts by user_id', async () => {
    await insertLeagueCreationBlock('user-1', 'ban evasion', 'mod-1');
    const { text, params } = lastQuery();
    assert.ok(/INSERT INTO league_creation_blocks/i.test(text), `should insert into league_creation_blocks: ${text}`);
    assert.ok(/ON CONFLICT\s*\(user_id\)/i.test(text), `should upsert on user_id: ${text}`);
    assert.deepStrictEqual(params, ['user-1', 'ban evasion', 'mod-1']);
});

test('findLeagueCreationBlock queries by user_id', async () => {
    const row = await findLeagueCreationBlock('user-1');
    const { text, params } = lastQuery();
    assert.ok(/FROM league_creation_blocks/i.test(text), `should read league_creation_blocks: ${text}`);
    assert.deepStrictEqual(params, ['user-1']);
    assert.strictEqual(row, null);
});
