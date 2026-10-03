'use strict';

// Proves the exclusion constraint itself, which the stubbed-pg tests cannot.
// Runs only when EMH_TEST_DATABASE_URL points at a throwaway database.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { Client } = require('pg');
const { bookingsTableSql } = require('../utils/emh_schedule_queries');

const URL_ = process.env.EMH_TEST_DATABASE_URL;
const skip = !URL_ && 'set EMH_TEST_DATABASE_URL to run';
const SCHEMA = `emh_test_${process.pid}`;
const TABLE = `${SCHEMA}.emh_bookings`;
const clients = [];

const connect = async () => {
    const client = new Client({ connectionString: URL_ });
    await client.connect();
    clients.push(client);
    return client;
};

const insert = (client, start, end, status = 'scheduled') => client.query(
    `INSERT INTO ${TABLE} (host_id, host_username, starts_at, ends_at, status, created_by)
     VALUES ($1, $1, $2, $3, $4, $1) RETURNING id`,
    [`h${Math.random()}`, start, end, status]
);

before(async () => {
    if (skip) return;
    const admin = await connect();
    await admin.query(`CREATE SCHEMA ${SCHEMA}`);
    await admin.query(bookingsTableSql(TABLE));
});

after(async () => {
    if (skip) return;
    await clients[0].query(`DROP SCHEMA ${SCHEMA} CASCADE`);
    await Promise.all(clients.map((client) => client.end()));
});

test('two concurrent bookings for the same time: exactly one succeeds', { skip }, async () => {
    const a = await connect();
    const b = await connect();
    await a.query('BEGIN');
    await insert(a, '2026-10-07T00:00:00Z', '2026-10-07T01:00:00Z');
    const second = insert(b, '2026-10-07T00:30:00Z', '2026-10-07T01:30:00Z').then(() => 'ok', (error) => error.code);
    await a.query('COMMIT');
    assert.strictEqual(await second, '23P01');
});

test('touching slots are both allowed', { skip }, async () => {
    const c = clients[0];
    await insert(c, '2026-10-08T00:00:00Z', '2026-10-08T01:00:00Z');
    await insert(c, '2026-10-08T01:00:00Z', '2026-10-08T02:00:00Z');
});

test('moving a slot into another one fails and leaves it unchanged', { skip }, async () => {
    const c = clients[0];
    const { rows } = await insert(c, '2026-10-09T00:00:00Z', '2026-10-09T01:00:00Z');
    await insert(c, '2026-10-09T02:00:00Z', '2026-10-09T03:00:00Z');
    await assert.rejects(
        c.query(`UPDATE ${TABLE} SET starts_at = $2, ends_at = $3 WHERE id = $1`, [rows[0].id, '2026-10-09T02:30:00Z', '2026-10-09T03:30:00Z']),
        (error) => error.code === '23P01'
    );
    const after_ = await c.query(`SELECT starts_at FROM ${TABLE} WHERE id = $1`, [rows[0].id]);
    assert.strictEqual(after_.rows[0].starts_at.toISOString(), '2026-10-09T00:00:00.000Z');
});

test('a cancelled slot does not block the time', { skip }, async () => {
    const c = clients[0];
    await insert(c, '2026-10-10T00:00:00Z', '2026-10-10T01:00:00Z', 'cancelled');
    await insert(c, '2026-10-10T00:00:00Z', '2026-10-10T01:00:00Z');
});
