'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

// Scriptable pg stub: each queued entry is returned in order; an Error entry
// is thrown instead, so 23505 paths are testable.
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

const squadDb = require('../utils/squad_db');
const sqlLog = () => captured.map((c) => c.text).join('\n');

test('addSquadMember locks the squad row and rejects a full squad', async () => {
    captured.length = 0;
    resultQueue.push(
        { rows: [], rowCount: 0 },                       // BEGIN
        { rows: [{ id: 1 }], rowCount: 1 },              // SELECT ... FOR UPDATE
        { rows: [{ n: 9 }], rowCount: 1 },               // member count = 9 (full)
        { rows: [], rowCount: 0 }                        // ROLLBACK
    );
    const result = await squadDb.addSquadMember(1, 'user-1', 'name');
    assert.deepStrictEqual(result, { ok: false, code: 'FULL' });
    assert.match(sqlLog(), /FOR UPDATE/);
    assert.match(sqlLog(), /ROLLBACK/);
});

test('addSquadMember maps the unique-membership 23505 to ALREADY_MEMBER', async () => {
    captured.length = 0;
    const dupe = Object.assign(new Error('duplicate'), { code: '23505' });
    resultQueue.push(
        { rows: [], rowCount: 0 },
        { rows: [{ id: 1 }], rowCount: 1 },
        { rows: [{ n: 3 }], rowCount: 1 },
        dupe,
        { rows: [], rowCount: 0 }                        // ROLLBACK
    );
    const result = await squadDb.addSquadMember(1, 'user-1', 'name');
    assert.deepStrictEqual(result, { ok: false, code: 'ALREADY_MEMBER' });
});

test('addSquadMember succeeds under capacity', async () => {
    captured.length = 0;
    resultQueue.push(
        { rows: [], rowCount: 0 },
        { rows: [{ id: 1 }], rowCount: 1 },
        { rows: [{ n: 3 }], rowCount: 1 },
        { rows: [{ squad_id: 1, user_id: 'user-1' }], rowCount: 1 },
        { rows: [], rowCount: 0 }                        // COMMIT
    );
    const result = await squadDb.addSquadMember(1, 'user-1', 'name');
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.member.user_id, 'user-1');
    assert.match(sqlLog(), /COMMIT/);
});

test('disbandSquad with ownerId guard returns null for a non-owner', async () => {
    captured.length = 0;
    resultQueue.push(
        { rows: [], rowCount: 0 },
        { rows: [], rowCount: 0 },   // guarded SELECT ... FOR UPDATE finds nothing
        { rows: [], rowCount: 0 }    // ROLLBACK
    );
    const result = await squadDb.disbandSquad(1, { ownerId: 'not-owner' });
    assert.strictEqual(result, null);
});

test('disbandSquad captures members and detaches B-team links before deleting', async () => {
    captured.length = 0;
    resultQueue.push(
        { rows: [], rowCount: 0 },                                   // BEGIN
        { rows: [{ id: 1, name: 'ABC' }], rowCount: 1 },             // FOR UPDATE
        { rows: [{ user_id: 'm1' }], rowCount: 1 },                  // members
        { rows: [], rowCount: 0 },                                   // detach children
        { rows: [], rowCount: 0 },                                   // DELETE
        { rows: [], rowCount: 0 }                                    // COMMIT
    );
    const result = await squadDb.disbandSquad(1, {});
    assert.strictEqual(result.squad.name, 'ABC');
    assert.deepStrictEqual(result.members, [{ user_id: 'm1' }]);
    assert.match(sqlLog(), /SET parent_squad_id = NULL/);
});

test('transferSquadOwnership moves the whole name group, severs A/B links, and demotes a fully-out old owner to member', async () => {
    captured.length = 0;
    resultQueue.push(
        { rows: [], rowCount: 0 },                                  // BEGIN
        { rows: [{ id: 1, name: 'ABC', owner_id: 'old' }], rowCount: 1 },  // squad FOR UPDATE, owner guard
        { rows: [{ user_id: 'new' }], rowCount: 1 },                // new owner was a member
        { rows: [{ id: 1, owner_id: 'new' }, { id: 5, owner_id: 'new' }], rowCount: 2 }, // name-group UPDATE RETURNING
        { rows: [], rowCount: 0 },                                  // sever A/B links
        { rows: [], rowCount: 0 },                                  // old owner owns nothing else
        { rows: [], rowCount: 0 },                                  // INSERT old owner as member
        { rows: [], rowCount: 0 }                                   // COMMIT
    );
    const squad = await squadDb.transferSquadOwnership(1, 'old', 'new', 'newname', 'oldname');
    assert.strictEqual(squad.owner_id, 'new');
    assert.strictEqual(squad.id, 1);
    assert.match(sqlLog(), /SET parent_squad_id = NULL/);
    assert.ok(captured.some((c) => c.text.includes('INSERT INTO squad_members')));
    assert.match(sqlLog(), /BEGIN[\s\S]*COMMIT/);
});

test('transferSquadOwnership keeps an old owner who still leads another squad out of the member list', async () => {
    captured.length = 0;
    resultQueue.push(
        { rows: [], rowCount: 0 },                                  // BEGIN
        { rows: [{ id: 2, name: 'BBB', owner_id: 'old' }], rowCount: 1 },  // transferring the B team
        { rows: [{ user_id: 'new' }], rowCount: 1 },
        { rows: [{ id: 2, owner_id: 'new' }], rowCount: 1 },
        { rows: [], rowCount: 0 },                                  // sever links
        { rows: [{ '?column?': 1 }], rowCount: 1 },                 // old owner still owns the A team
        { rows: [], rowCount: 0 }                                   // COMMIT
    );
    const squad = await squadDb.transferSquadOwnership(2, 'old', 'new', 'newname', 'oldname');
    assert.strictEqual(squad.owner_id, 'new');
    assert.ok(!captured.some((c) => c.text.includes('INSERT INTO squad_members')));
});

test('transferSquadOwnership refuses when the target is not a member', async () => {
    captured.length = 0;
    resultQueue.push(
        { rows: [], rowCount: 0 },
        { rows: [{ id: 1, owner_id: 'old' }], rowCount: 1 },
        { rows: [], rowCount: 0 },   // target not a member
        { rows: [], rowCount: 0 }    // ROLLBACK
    );
    const squad = await squadDb.transferSquadOwnership(1, 'old', 'new', 'newname', 'oldname');
    assert.strictEqual(squad, null);
});

test('moveMemberBetweenSquads rejects a full destination', async () => {
    captured.length = 0;
    resultQueue.push(
        { rows: [], rowCount: 0 },
        { rows: [{ id: 2 }], rowCount: 1 },
        { rows: [{ n: 9 }], rowCount: 1 },
        { rows: [], rowCount: 0 }
    );
    const result = await squadDb.moveMemberBetweenSquads(1, 2, 'user-1');
    assert.deepStrictEqual(result, { ok: false, code: 'FULL' });
});
