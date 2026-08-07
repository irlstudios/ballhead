'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

// Stub the pg Pool before db.js is required (pool is created at module load).
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

const { setLeagueType, fetchLeaguesForTierSync } = require('../db');

const lastQuery = () => capturedQueries[capturedQueries.length - 1];

// The tier claim must be conditional: expected old tier and live status in the
// WHERE clause, so a stale snapshot can never clobber a staff move or disband.
test('setLeagueType claims conditionally and reports the outcome', async () => {
    const claimed = await setLeagueType(7, 'Active', 'Base');
    const { text, params } = lastQuery();
    assert.ok(/WHERE league_id = \$2 AND league_type = \$3/i.test(text), `claim must check expected tier: ${text}`);
    assert.ok(/league_status = 'Active'/i.test(text), `claim must require live status: ${text}`);
    assert.ok(/RETURNING/i.test(text), `claim must return the claimed row: ${text}`);
    assert.deepStrictEqual(params, ['Active', 7, 'Base']);
    assert.strictEqual(claimed, false);
});

test('fetchLeaguesForTierSync scopes to live Base and Active leagues', async () => {
    await fetchLeaguesForTierSync();
    const { text } = lastQuery();
    assert.ok(/league_status = 'Active'/i.test(text), `must exclude disbanded/inactive: ${text}`);
    assert.ok(/league_type IN \('Base', 'Active'\)/i.test(text), `must exclude Sponsored: ${text}`);
});
