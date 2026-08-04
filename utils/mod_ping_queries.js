'use strict';

// Database access for /mod-pings subscriptions. Kept out of db.js, which is
// already well past the project's file-size ceiling; utils/host_session_queries.js
// is the precedent.

const { executeQuery } = require('../db');

const ensureModPingSubscriptionsTable = async () => {
    await executeQuery(`
        CREATE TABLE IF NOT EXISTS mod_ping_subscriptions (
            user_id TEXT NOT NULL,
            role_id TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (user_id, role_id)
        )
    `);
};

const subscribeToModPings = async (userId, roleIds) => {
    await executeQuery(
        `INSERT INTO mod_ping_subscriptions (user_id, role_id)
         SELECT $1, unnest($2::text[])
         ON CONFLICT (user_id, role_id) DO NOTHING`,
        [userId, roleIds]
    );
};

const unsubscribeFromModPings = async (userId, roleIds) => {
    await executeQuery(
        'DELETE FROM mod_ping_subscriptions WHERE user_id = $1 AND role_id = ANY($2::text[])',
        [userId, roleIds]
    );
};

const listModPingSubscriptions = async (userId) => {
    const result = await executeQuery(
        'SELECT role_id FROM mod_ping_subscriptions WHERE user_id = $1 ORDER BY created_at',
        [userId]
    );
    return result.rows.map((row) => row.role_id);
};

const getModPingSubscribers = async (roleIds) => {
    const result = await executeQuery(
        'SELECT user_id, role_id FROM mod_ping_subscriptions WHERE role_id = ANY($1::text[])',
        [roleIds]
    );
    return result.rows;
};

module.exports = {
    ensureModPingSubscriptionsTable,
    subscribeToModPings,
    unsubscribeFromModPings,
    listModPingSubscriptions,
    getModPingSubscribers,
};
