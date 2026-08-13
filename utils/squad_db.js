'use strict';

// Postgres query layer for squads. Replaced utils/squad_queries.js sheet
// reads 2026-08. All mutations are transactions; capacity checks take a row
// lock on the squad, so concurrent joins serialize without the old
// in-process squad_lock (which was never multi-process safe anyway).

const { pool, executeQuery } = require('../db');

const MAX_SQUAD_MEMBERS = 10; // owner + 9 members

function normalizeSquadName(raw) {
    return String(raw ?? '').trim().toUpperCase();
}

// Pure: pick which owned squad a command targets. A Casual+Competitive pair
// shares a name and acts as one squad for membership purposes (the sheet era
// keyed members by name); the Competitive row wins so members attach where
// the import put them.
function disambiguateOwnedSquad(ownedSquads, specifiedName) {
    const byName = new Map();
    for (const s of ownedSquads) {
        const existing = byName.get(s.name);
        if (!existing || (existing.squad_type !== 'Competitive' && s.squad_type === 'Competitive')) {
            byName.set(s.name, s);
        }
    }
    const unique = [...byName.values()];
    if (unique.length === 0) {
        return { squad: null, error: 'You do not own any squads.' };
    }
    if (unique.length === 1) {
        return { squad: unique[0], error: null };
    }
    if (!specifiedName) {
        return { squad: null, error: `You own multiple squads. Please specify which squad: ${unique.map((s) => s.name).join(', ')}` };
    }
    const match = unique.find((s) => s.name === normalizeSquadName(specifiedName));
    if (!match) {
        return { squad: null, error: `You do not own a squad named "${specifiedName}".` };
    }
    return { squad: match, error: null };
}

const fetchSquadsByOwner = async (ownerId) => {
    const r = await executeQuery('SELECT * FROM squads WHERE owner_id = $1 ORDER BY id', [ownerId]);
    return r.rows;
};

const fetchSquadByNameAndType = async (name, squadType) => {
    const r = await executeQuery(
        'SELECT * FROM squads WHERE name = $1 AND squad_type = $2',
        [normalizeSquadName(name), squadType]
    );
    return r.rows[0] || null;
};

const fetchSquadsByName = async (name) => {
    const r = await executeQuery('SELECT * FROM squads WHERE name = $1', [normalizeSquadName(name)]);
    return r.rows;
};

const fetchSquadById = async (id) => {
    const r = await executeQuery('SELECT * FROM squads WHERE id = $1', [id]);
    return r.rows[0] || null;
};

// The one squad a user is a member of (membership is unique per user), or null.
const fetchMembership = async (userId) => {
    const r = await executeQuery(
        `SELECT s.*, m.user_id AS member_user_id, m.username AS member_username, m.joined_at
         FROM squad_members m JOIN squads s ON s.id = m.squad_id
         WHERE m.user_id = $1`,
        [userId]
    );
    if (!r.rows[0]) {
        return null;
    }
    const { member_user_id, member_username, joined_at, ...squad } = r.rows[0];
    return { squad, member: { user_id: member_user_id, username: member_username, joined_at } };
};

const fetchSquadMembers = async (squadId) => {
    const r = await executeQuery(
        'SELECT * FROM squad_members WHERE squad_id = $1 ORDER BY joined_at',
        [squadId]
    );
    return r.rows;
};

const fetchAllSquadsWithCounts = async () => {
    const r = await executeQuery(
        `SELECT s.*, COUNT(m.user_id)::int AS member_count
         FROM squads s LEFT JOIN squad_members m ON m.squad_id = s.id
         GROUP BY s.id ORDER BY s.name, s.squad_type`
    );
    return r.rows;
};

// The /squad join-random pool: open squads with room for one more member.
// The Casual half of a Casual+Competitive pair is excluded at the source
// (members live on the Competitive row), so a full Competitive can never
// expose its empty Casual sibling as a separate join target.
const fetchOpenSquadsWithSpace = async () => {
    const r = await executeQuery(
        `SELECT s.* FROM squads s LEFT JOIN squad_members m ON m.squad_id = s.id
         WHERE s.open_squad
           AND NOT EXISTS (
               SELECT 1 FROM squads c
               WHERE c.name = s.name AND c.owner_id = s.owner_id
                 AND c.squad_type = 'Competitive' AND c.id <> s.id
           )
         GROUP BY s.id
         HAVING COUNT(m.user_id) < $1`,
        [MAX_SQUAD_MEMBERS - 1]
    );
    return r.rows;
};

const getInvitesOptIn = async (userId) => {
    const r = await executeQuery('SELECT invites_opt_in FROM user_squad_prefs WHERE user_id = $1', [userId]);
    return r.rows[0] ? r.rows[0].invites_opt_in : true;
};

// --- mutations ---------------------------------------------------------------

const setInvitesOptIn = async (userId, optIn) => {
    await executeQuery(
        `INSERT INTO user_squad_prefs (user_id, invites_opt_in) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET invites_opt_in = EXCLUDED.invites_opt_in`,
        [userId, optIn]
    );
};

// Throws pg 23505 when (name, type) is already taken; callers map it to copy.
const createSquad = async ({ name, squadType, ownerId, ownerUsername, eventSquad = null, parentSquadId = null }) => {
    const r = await executeQuery(
        `INSERT INTO squads (name, squad_type, owner_id, owner_username, event_squad, parent_squad_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [normalizeSquadName(name), squadType, ownerId, ownerUsername, eventSquad, parentSquadId]
    );
    return r.rows[0];
};

// Capacity and one-squad-per-user enforced atomically: the squad row lock
// serialises concurrent joins; the UNIQUE(user_id) index turns a concurrent
// second membership into a 23505 mapped to ALREADY_MEMBER.
const addSquadMember = async (squadId, userId, username) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const squad = await client.query('SELECT id FROM squads WHERE id = $1 FOR UPDATE', [squadId]);
        if (squad.rowCount === 0) {
            await client.query('ROLLBACK');
            return { ok: false, code: 'NO_SQUAD' };
        }
        const count = await client.query('SELECT COUNT(*)::int AS n FROM squad_members WHERE squad_id = $1', [squadId]);
        if (count.rows[0].n >= MAX_SQUAD_MEMBERS - 1) {
            await client.query('ROLLBACK');
            return { ok: false, code: 'FULL' };
        }
        const inserted = await client.query(
            'INSERT INTO squad_members (squad_id, user_id, username) VALUES ($1, $2, $3) RETURNING *',
            [squadId, userId, username]
        );
        await client.query('COMMIT');
        return { ok: true, member: inserted.rows[0] };
    } catch (err) {
        await client.query('ROLLBACK');
        if (err.code === '23505') {
            return { ok: false, code: 'ALREADY_MEMBER' };
        }
        throw err;
    } finally {
        client.release();
    }
};

const removeSquadMember = async (squadId, userId) => {
    const r = await executeQuery(
        'DELETE FROM squad_members WHERE squad_id = $1 AND user_id = $2 RETURNING *',
        [squadId, userId]
    );
    return r.rows[0] || null;
};

// For /squad leave: membership is unique per user, so no squad id is needed.
const removeMembershipAnywhere = async (userId) => {
    const r = await executeQuery('DELETE FROM squad_members WHERE user_id = $1 RETURNING squad_id', [userId]);
    return r.rows[0] || null;
};

// Atomic disband: optional owner guard (omitted for force-disband), members
// captured before the cascade so callers can DM them, and any B team pointing
// here is detached before the parent row goes.
const disbandSquad = async (squadId, { ownerId = null } = {}) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const guard = ownerId
            ? await client.query('SELECT * FROM squads WHERE id = $1 AND owner_id = $2 FOR UPDATE', [squadId, ownerId])
            : await client.query('SELECT * FROM squads WHERE id = $1 FOR UPDATE', [squadId]);
        if (guard.rowCount === 0) {
            await client.query('ROLLBACK');
            return null;
        }
        const members = await client.query('SELECT * FROM squad_members WHERE squad_id = $1', [squadId]);
        await client.query('UPDATE squads SET parent_squad_id = NULL WHERE parent_squad_id = $1', [squadId]);
        await client.query('DELETE FROM squads WHERE id = $1', [squadId]);
        await client.query('COMMIT');
        return { squad: guard.rows[0], members: members.rows };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

// Throws pg 23505 when the new (name, type) is taken.
const renameSquad = async (squadId, newName) => {
    const r = await executeQuery(
        'UPDATE squads SET name = $2 WHERE id = $1 RETURNING *',
        [squadId, normalizeSquadName(newName)]
    );
    return r.rows[0] || null;
};

// Atomic pair rename: a Casual+Competitive pair renames in one statement so a
// failure can never leave the two rows under different names. Throws 23505
// when the new name is taken.
const renameSquads = async (squadIds, newName) => {
    const r = await executeQuery(
        'UPDATE squads SET name = $2 WHERE id = ANY($1::int[]) RETURNING *',
        [squadIds, normalizeSquadName(newName)]
    );
    return r.rows;
};

// Swap owner and member atomically: the old owner becomes a member, the new
// owner's member row is consumed, same-name sibling rows (the Casual half of
// a pair) move in the same transaction so a name never splits between owners,
// and any A/B parent link touching the transferred rows is severed (the pair
// invariant is same-owner; a transferred B team must not keep settle rights
// on someone else's A team). Null when the guard or membership fails.
const transferSquadOwnership = async (squadId, oldOwnerId, newOwnerId, newOwnerUsername, oldOwnerUsername) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const squad = await client.query(
            'SELECT * FROM squads WHERE id = $1 AND owner_id = $2 FOR UPDATE',
            [squadId, oldOwnerId]
        );
        if (squad.rowCount === 0) {
            await client.query('ROLLBACK');
            return null;
        }
        const wasMember = await client.query(
            'DELETE FROM squad_members WHERE squad_id = $1 AND user_id = $2 RETURNING user_id',
            [squadId, newOwnerId]
        );
        if (wasMember.rowCount === 0) {
            await client.query('ROLLBACK');
            return null;
        }
        await client.query(
            'INSERT INTO squad_members (squad_id, user_id, username) VALUES ($1, $2, $3)',
            [squadId, oldOwnerId, oldOwnerUsername]
        );
        // Main row plus same-name siblings still held by the old owner.
        const moved = await client.query(
            `UPDATE squads SET owner_id = $3, owner_username = $4
             WHERE name = $2 AND owner_id = $1 RETURNING *`,
            [oldOwnerId, squad.rows[0].name, newOwnerId, newOwnerUsername]
        );
        // Sever A/B links that now cross owners.
        const movedIds = moved.rows.map((r) => r.id);
        await client.query(
            `UPDATE squads SET parent_squad_id = NULL
             WHERE (id = ANY($1::int[]) AND parent_squad_id IS NOT NULL)
                OR parent_squad_id = ANY($1::int[])`,
            [movedIds]
        );
        await client.query('COMMIT');
        return moved.rows.find((r) => r.id === squadId) || moved.rows[0];
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

// Promote/demote between an owner's A and B teams, capacity-checked on the
// destination under its row lock.
const moveMemberBetweenSquads = async (fromSquadId, toSquadId, userId) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT id FROM squads WHERE id = $1 FOR UPDATE', [toSquadId]);
        const count = await client.query('SELECT COUNT(*)::int AS n FROM squad_members WHERE squad_id = $1', [toSquadId]);
        if (count.rows[0].n >= MAX_SQUAD_MEMBERS - 1) {
            await client.query('ROLLBACK');
            return { ok: false, code: 'FULL' };
        }
        const moved = await client.query(
            'UPDATE squad_members SET squad_id = $2 WHERE squad_id = $1 AND user_id = $3 RETURNING *',
            [fromSquadId, toSquadId, userId]
        );
        if (moved.rowCount === 0) {
            await client.query('ROLLBACK');
            return { ok: false, code: 'NOT_MEMBER' };
        }
        await client.query('COMMIT');
        return { ok: true };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

module.exports = {
    MAX_SQUAD_MEMBERS,
    normalizeSquadName,
    disambiguateOwnedSquad,
    fetchSquadsByOwner,
    fetchSquadByNameAndType,
    fetchSquadsByName,
    fetchSquadById,
    fetchMembership,
    fetchSquadMembers,
    fetchAllSquadsWithCounts,
    fetchOpenSquadsWithSpace,
    getInvitesOptIn,
    setInvitesOptIn,
    createSquad,
    addSquadMember,
    removeSquadMember,
    removeMembershipAnywhere,
    disbandSquad,
    renameSquad,
    transferSquadOwnership,
    renameSquads,
    moveMemberBetweenSquads,
};
