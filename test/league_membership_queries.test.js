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
    fetchLeaguesByOwner,
    fetchLeaguesByCoOwner,
    isUserCoOwnerAnywhere,
    findActiveLeague,
} = require('../db');

const lastQuery = () => capturedQueries[capturedQueries.length - 1].text;
const excludesDisbanded = (sql) => /league_status\s*<>\s*'Disbanded'/i.test(sql);

// A disbanded league must never count as an active membership. These three
// lookups gate co-owner assignment, check-ins and invite updates, so each one
// must exclude leagues whose status is 'Disbanded'.

test('fetchLeaguesByOwner excludes disbanded leagues', async () => {
    await fetchLeaguesByOwner('owner-1');
    assert.ok(
        excludesDisbanded(lastQuery()),
        `query should exclude disbanded leagues: ${lastQuery()}`
    );
});

test('fetchLeaguesByCoOwner excludes disbanded leagues', async () => {
    await fetchLeaguesByCoOwner('user-1');
    assert.ok(
        excludesDisbanded(lastQuery()),
        `query should exclude disbanded leagues: ${lastQuery()}`
    );
});

test('isUserCoOwnerAnywhere excludes disbanded leagues', async () => {
    await isUserCoOwnerAnywhere('user-1');
    assert.ok(
        excludesDisbanded(lastQuery()),
        `query should exclude disbanded leagues: ${lastQuery()}`
    );
});

// findActiveLeague gates new league registration: by owner_id it blocks a user
// who "already owns" a league, and by server_id it blocks a server that is
// "already registered". A disbanded league frees up both, so neither guard may
// count it.

test('findActiveLeague by owner_id excludes disbanded leagues', async () => {
    await findActiveLeague('owner_id', 'owner-1');
    assert.ok(
        excludesDisbanded(lastQuery()),
        `query should exclude disbanded leagues: ${lastQuery()}`
    );
});

test('findActiveLeague by server_id excludes disbanded leagues', async () => {
    await findActiveLeague('server_id', 'server-1');
    assert.ok(
        excludesDisbanded(lastQuery()),
        `query should exclude disbanded leagues: ${lastQuery()}`
    );
});
