'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const captured = [];
const resultQueue = [];
const pg = require('pg');
pg.Pool.prototype.connect = async function connect() {
    return {
        query: async (text, params) => {
            captured.push({ text: String(text), params });
            const next = resultQueue.length ? resultQueue.shift() : { rows: [], rowCount: 0 };
            if (next instanceof Error) {
                throw next;
            }
            return next;
        },
        release: () => {},
    };
};

const { ensureSquadsSchema } = require('../db');
const squadDb = require('../utils/squad_db');
const lastQuery = () => captured[captured.length - 1];

test('ensureSquadsSchema creates profile columns, applications, and practice tables', async () => {
    captured.length = 0;
    await ensureSquadsSchema();
    const sql = captured.map((q) => q.text).join('\n');
    assert.match(sql, /ADD COLUMN IF NOT EXISTS description TEXT/);
    assert.match(sql, /ADD COLUMN IF NOT EXISTS recruiting TEXT/);
    assert.match(sql, /SET recruiting = CASE WHEN open_squad THEN 'Open' ELSE 'Invite-only' END/);
    assert.match(sql, /WHERE recruiting IS NULL/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS squad_applications/);
    assert.match(sql, /idx_squad_apps_pending/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS squad_practices/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS squad_practice_rsvps/);
});

test('updateSquadProfile updates every squad row the owner holds under the name', async () => {
    captured.length = 0;
    await squadDb.updateSquadProfile('abc', 'owner-1', { description: 'hi', recruiting: 'Apply' });
    const { text, params } = lastQuery();
    assert.match(text, /COALESCE/);
    assert.match(text, /WHERE name = \$1 AND owner_id = \$2/);
    assert.deepStrictEqual(params.slice(0, 2), ['ABC', 'owner-1']);
});

test('fetchBrowseSquads orders recruiting squads first with member counts', async () => {
    captured.length = 0;
    await squadDb.fetchBrowseSquads();
    const { text } = lastQuery();
    assert.match(text, /COUNT\(m\.user_id\)::int AS member_count/);
    assert.match(text, /recruiting/);
    assert.match(text, /ORDER BY/);
    assert.match(text, /NOT EXISTS/i); // Casual half of a pair excluded
});

test('insertApplication maps the pending-unique 23505 to DUPLICATE', async () => {
    captured.length = 0;
    resultQueue.push(Object.assign(new Error('dup'), { code: '23505' }));
    const result = await squadDb.insertApplication({ squadId: 1, userId: 'u', username: 'n', message: null });
    assert.deepStrictEqual(result, { ok: false, code: 'DUPLICATE' });
});

test('claimApplication is a Pending-only transition', async () => {
    captured.length = 0;
    await squadDb.claimApplication(5, 'Accepted', 'owner-1');
    const { text, params } = lastQuery();
    assert.match(text, /WHERE id = \$1 AND status = 'Pending'/);
    assert.match(text, /RETURNING \*/);
    assert.deepStrictEqual(params, [5, 'Accepted', 'owner-1']);
});

test('expireOldApplications expires pending rows older than the cutoff and returns them', async () => {
    captured.length = 0;
    await squadDb.expireOldApplications(7);
    const { text, params } = lastQuery();
    assert.match(text, /status = 'Pending'/);
    assert.match(text, /created_at < NOW\(\) - \(\$1 \|\| ' days'\)::interval/);
    assert.match(text, /RETURNING \*/);
    assert.deepStrictEqual(params, ['7']);
});

test('practice due queries select by status, time, and reminder flag', async () => {
    captured.length = 0;
    await squadDb.fetchDuePracticeReminders(15);
    assert.match(lastQuery().text, /reminder_sent = FALSE/);
    assert.match(lastQuery().text, /status = 'Scheduled'/);

    await squadDb.fetchDuePracticeStarts();
    assert.match(lastQuery().text, /scheduled_at <= NOW\(\)/);

    await squadDb.fetchDuePracticeCleanups(24);
    assert.match(lastQuery().text, /status = 'Started'/);
});

test('upsertRsvp overwrites a previous response', async () => {
    captured.length = 0;
    await squadDb.upsertRsvp(3, 'user-1', 'Yes');
    const { text } = lastQuery();
    assert.match(text, /ON CONFLICT \(practice_id, user_id\) DO UPDATE/);
});
