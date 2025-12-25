const { Pool } = require('pg');

const poolConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    database: process.env.DB_DATABASE_NAME,
    password: process.env.DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
    max: 20, // Maximum number of clients in the pool
    idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
    connectionTimeoutMillis: 2000, // Return an error after 2 seconds if unable to get a client
};

// Create a connection pool for better performance
const pool = new Pool(poolConfig);

// Log pool errors
pool.on('error', (err) => {
    console.error('[DB Pool] Unexpected error on idle client', err);
});

// Execute query using connection pool
const executeQuery = async (query, params) => {
    const client = await pool.connect();
    try {
        const result = await client.query(query, params);
        return result;
    } catch (err) {
        console.error('[DB] Query error:', err);
        throw err;
    } finally {
        client.release(); // Return client to pool
    }
};

// Graceful shutdown function
const closePool = async () => {
    await pool.end();
    console.log('[DB Pool] Connection pool closed');
};

const insertCommandUsage = async (command_name, user_id, channel_id, server_id, timestamp) => {
    const query = `
        INSERT INTO command_usage (command_name, user_id, channel_id, server_id, timestamp)
        VALUES ($1, $2, $3, $4, $5)
    `;
    await executeQuery(query, [command_name, user_id, channel_id, server_id, timestamp]);
};

const insertSquadApplication = async (member_display_name, member_object, member_squad_name, message_url, user_id, squad_type) => {
    const query = `
        INSERT INTO squad_applications_data (member_display_name, member_object, member_squad_name, message_url, user_id, squad_type)
        VALUES ($1, $2, $3, $4, $5, $6)
    `;
    await executeQuery(query, [member_display_name, member_object, member_squad_name, message_url, user_id, squad_type]);
};

const fetchCommandUsageData = async () => {
    const query = 'SELECT * FROM command_usage';
    const result = await executeQuery(query);
    return result.rows;
};

const fetchSquadApplications = async () => {
    const query = 'SELECT * FROM squad_applications_data';
    const result = await executeQuery(query);
    return result.rows;
};

const fetchSquadApplicationByMessageUrl = async (message_url) => {
    const query = 'SELECT * FROM squad_applications_data WHERE message_url = $1';
    const result = await executeQuery(query, [message_url]);
    return result.rows[0];
};

const deleteSquadApplicationById = async (id) => {
    const query = 'DELETE FROM squad_applications_data WHERE id = $1';
    const result = await executeQuery(query, [id]);
    return result.rowCount > 0;
};

const insertInvite = async (command_user_id, invited_member_id, squad_name, message_id, tracking_message_id, squad_type) => {
    const query = `
        INSERT INTO invites (command_user_id, invited_member_id, squad_name, invite_status, message_id, tracking_message_id, squad_type)
        VALUES ($1, $2, $3, 'Pending', $4, $5, $6)
    `;
    await executeQuery(query, [command_user_id, invited_member_id, squad_name, message_id, tracking_message_id, squad_type]);
};

const deleteInvite = async (message_id) => {
    const query = 'DELETE FROM invites WHERE message_id = $1';
    const result = await executeQuery(query, [message_id]);
    return result.rowCount > 0;
};

const updateInviteStatus = async (message_id, status) => {
    const query = 'UPDATE invites SET invite_status = $1 WHERE message_id = $2';
    await executeQuery(query, [status, message_id]);
};

const fetchInviteById = async (message_id) => {
    const query = 'SELECT * FROM invites WHERE message_id = $1';
    const result = await executeQuery(query, [message_id]);
    return result.rows[0];
};

const updateUserReputation = async (user_id) => {
    const query = `
        INSERT INTO user_reputation (user_id, rep_count)
        VALUES ($1, 1)
        ON CONFLICT (user_id)
        DO UPDATE SET rep_count = user_reputation.rep_count + 1, last_updated = CURRENT_TIMESTAMP
    `;
    await executeQuery(query, [user_id]);
};

const fetchTopUsersByReputation = async (limit) => {
    const query = `
        SELECT user_id, rep_count
        FROM user_reputation
        ORDER BY rep_count DESC
        LIMIT $1
    `;
    const result = await executeQuery(query, [limit]);
    return result.rows;
};

const removeRep = async (user_id, amount) => {
    const query = `
        UPDATE user_reputation
        SET rep_count = GREATEST(rep_count - $2, 0), last_updated = CURRENT_TIMESTAMP
        WHERE user_id = $1
        RETURNING *
    `;
    const result = await executeQuery(query, [user_id, amount]);
    return result.rows;
};

module.exports = {
    removeRep,
    fetchTopUsersByReputation,
    insertCommandUsage,
    insertSquadApplication,
    fetchCommandUsageData,
    fetchSquadApplications,
    fetchSquadApplicationByMessageUrl,
    deleteSquadApplicationById,
    insertInvite,
    deleteInvite,
    updateInviteStatus,
    fetchInviteById,
    updateUserReputation,
    closePool,
    pool
};
