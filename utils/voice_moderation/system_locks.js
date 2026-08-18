'use strict';

// Rooms the outage handler locked, pending auto-unlock on PC recovery.
// Host-initiated locks never appear here.

const { executeQuery } = require('../../db');

const ensureVcSystemLocksSchema = async () => {
    await executeQuery(`
        CREATE TABLE IF NOT EXISTS vc_system_locks (
            channel_id TEXT PRIMARY KEY,
            locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
};

const addSystemLock = async (channelId) => {
    await executeQuery(
        `INSERT INTO vc_system_locks (channel_id) VALUES ($1)
         ON CONFLICT (channel_id) DO NOTHING`,
        [channelId]
    );
};

const removeSystemLock = async (channelId) => {
    await executeQuery('DELETE FROM vc_system_locks WHERE channel_id = $1', [channelId]);
};

const listSystemLocks = async () => {
    const result = await executeQuery('SELECT channel_id FROM vc_system_locks');
    return result.rows.map((row) => row.channel_id);
};

module.exports = { ensureVcSystemLocksSchema, addSystemLock, removeSystemLock, listSystemLocks };
