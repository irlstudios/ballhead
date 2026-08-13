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
const fetchOpenSquadsWithSpace = async () => {
    const r = await executeQuery(
        `SELECT s.* FROM squads s LEFT JOIN squad_members m ON m.squad_id = s.id
         WHERE s.open_squad
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

module.exports = {
    MAX_SQUAD_MEMBERS,
    normalizeSquadName,
    fetchSquadsByOwner,
    fetchSquadByNameAndType,
    fetchSquadsByName,
    fetchSquadById,
    fetchMembership,
    fetchSquadMembers,
    fetchAllSquadsWithCounts,
    fetchOpenSquadsWithSpace,
    getInvitesOptIn,
};
