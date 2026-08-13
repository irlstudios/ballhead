'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

// Capture every SQL statement db.js sends by stubbing the pg Pool before
// db.js is required (the pool is created at module load time), matching
// test/league_creation_blocks.test.js.
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

const { ensureSquadsSchema } = require('../db');

test('ensureSquadsSchema creates squads, squad_members, user_squad_prefs with the specced constraints', async () => {
    await ensureSquadsSchema();
    const sql = capturedQueries.map((q) => q.text).join('\n');
    assert.match(sql, /CREATE TABLE IF NOT EXISTS squads/);
    assert.match(sql, /UNIQUE \(name, squad_type\)/);
    assert.match(sql, /parent_squad_id INTEGER REFERENCES squads\(id\)/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS squad_members/);
    assert.match(sql, /user_id\s+TEXT NOT NULL UNIQUE/);
    assert.match(sql, /ON DELETE CASCADE/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS user_squad_prefs/);
    assert.match(sql, /invites_opt_in BOOLEAN NOT NULL DEFAULT TRUE/);
    assert.match(sql, /idx_squads_owner/);
});
