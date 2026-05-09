const { Pool } = require('pg');
const logger = require('./utils/logger');

const poolConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    database: process.env.DB_DATABASE_NAME,
    password: process.env.DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
};

const pool = new Pool(poolConfig);

pool.on('error', (err) => {
    logger.error('[DB Pool] Unexpected error on idle client', err);
});

const executeQuery = async (query, params) => {
    const client = await pool.connect();
    try {
        const result = await client.query(query, params);
        return result;
    } catch (err) {
        logger.error('[DB] Query error:', err);
        throw err;
    } finally {
        client.release();
    }
};

const closePool = async () => {
    await pool.end();
    logger.info('[DB Pool] Connection pool closed');
};

// Officials application queries (moved from interactionHandler.js to use pool)
const findOfficialApplication = async (discordId) => {
    const result = await executeQuery(
        'SELECT * FROM official_applications WHERE discord_id = $1',
        [discordId]
    );
    return result.rows;
};

const insertOfficialApplication = async (discordId, username, inGameUsername, agreedToRules, understandsConsequences, applicationUrl) => {
    await executeQuery(
        `INSERT INTO official_applications (discord_id, discord_username, in_game_username, agreed_to_rules, understands_consequences, application_url, submitted_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [discordId, username, inGameUsername, agreedToRules, understandsConsequences, applicationUrl]
    );
};

const deleteOfficialApplication = async (discordId) => {
    await executeQuery(
        'DELETE FROM official_applications WHERE discord_id = $1',
        [discordId]
    );
};

// League queries (moved from interactionHandler.js to use pool)
const findLeagueApplication = async (applicationMessageId) => {
    const result = await executeQuery(
        'SELECT * FROM "League Applications" WHERE application_message_id = $1',
        [applicationMessageId]
    );
    return result.rows;
};

const updateLeagueApplicationApproval = async (messageId, reviewerId) => {
    await executeQuery(
        'UPDATE "League Applications" SET review_status = $1, is_approved = $2, reviewed_date = NOW(), reviewed_by = $3 WHERE application_message_id = $4',
        ['Approved', true, reviewerId, messageId]
    );
};

const updateLeagueApplicationDenial = async (messageId, denialReason, reviewerId) => {
    await executeQuery(
        'UPDATE "League Applications" SET review_status = $1, denial_reason = $2, reviewed_date = NOW(), reviewed_by = $3 WHERE application_message_id = $4',
        ['Denied', denialReason, reviewerId, messageId]
    );
};

const findActiveLeague = async (key, value) => {
    const validKeys = ['server_id', 'owner_id'];
    if (!validKeys.includes(key)) {
        throw new Error(`Invalid key: ${key}`);
    }
    const query = key === 'owner_id'
        ? 'SELECT * FROM "Active Leagues" WHERE owner_id = $1 AND league_type = \'Base\''
        : `SELECT * FROM "Active Leagues" WHERE ${key} = $1`;
    const result = await executeQuery(query, [value]);
    return result.rows;
};

const findActiveLeagueByOwnerAndName = async (ownerId, leagueName) => {
    const result = await executeQuery(
        'SELECT * FROM "Active Leagues" WHERE owner_id = $1 AND league_name = $2',
        [ownerId, leagueName]
    );
    return result.rows;
};

const insertActiveLeague = async (params) => {
    await executeQuery(
        `INSERT INTO "Active Leagues"
         (owner_id, owner_discord_name, league_name, server_name, server_id, member_count, server_owner_id, league_type, league_status, approval_date, is_sponsored, league_invite, server_icon, server_banner, vanity_url, server_description, server_features, owner_profile_picture)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Active', NOW(), $9, $10, $11, $12, $13, $14, $15, $16)`,
        params
    );
};

const updateActiveLeague = async (params) => {
    await executeQuery(
        `UPDATE "Active Leagues" SET
            league_type = $1, approval_date = NOW(), server_id = $2, server_name = $3,
            member_count = $4, server_icon = $5, server_banner = $6, vanity_url = $7,
            server_description = $8, server_features = $9, owner_profile_picture = $10
         WHERE owner_id = $11 AND league_name = $12`,
        params
    );
};

// LFG queries (moved from interactionHandler.js to use pool)
const ensureLfgTable = async () => {
    await executeQuery(`CREATE TABLE IF NOT EXISTS lfg_queues (
      thread_id TEXT PRIMARY KEY,
      queue_key TEXT NOT NULL,
      queue_name TEXT NOT NULL,
      size INTEGER NOT NULL,
      status TEXT NOT NULL,
      participants TEXT[] NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    // Add columns that may not exist on older tables
    const columns = [
        { name: 'description', type: 'TEXT' },
        { name: 'lobby_display_name', type: 'TEXT' },
        { name: 'lobby_id', type: 'TEXT' },
        { name: 'play_type', type: 'TEXT' },
        { name: 'play_rules', type: 'TEXT' },
        { name: 'region', type: 'TEXT' },
    ];
    for (const col of columns) {
        await executeQuery(
            `ALTER TABLE lfg_queues ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`
        ).catch(() => {});
    }
};

const findLfgParticipantQueues = async (userId, excludeKey) => {
    const result = await executeQuery(
        'SELECT thread_id, queue_key, queue_name, size, participants FROM lfg_queues WHERE $1 = ANY(participants) AND queue_key <> $2',
        [userId, excludeKey]
    );
    return result.rows;
};

const updateLfgParticipants = async (threadId, participants) => {
    await executeQuery(
        `UPDATE lfg_queues
           SET participants = COALESCE($1::text[], ARRAY[]::text[]),
               updated_at = NOW(),
               status = CASE
                          WHEN array_length(COALESCE($1::text[], ARRAY[]::text[]),1) IS NULL
                               OR array_length(COALESCE($1::text[], ARRAY[]::text[]),1) < size
                          THEN 'waiting'
                          ELSE 'ready'
                        END
         WHERE thread_id = $2`,
        [participants, threadId]
    );
};

const findLfgQueueByKey = async (key) => {
    const result = await executeQuery(
        `SELECT queue_key, queue_name, size,
                COALESCE(description,'') AS description,
                COALESCE(lobby_display_name,'') AS lobby_display_name
           FROM lfg_queues
          WHERE queue_key = $1
          ORDER BY updated_at DESC
          LIMIT 1`,
        [key]
    );
    if (!result.rows[0]) return null;
    const row = result.rows[0];
    return { key: row.queue_key, name: row.queue_name, size: row.size, description: row.description, lobby_display_name: row.lobby_display_name };
};

const findLfgQueueByThreadId = async (threadId) => {
    const result = await executeQuery(
        `SELECT queue_key, queue_name, size,
                COALESCE(description,'') AS description,
                COALESCE(lobby_display_name,'') AS lobby_display_name
           FROM lfg_queues
          WHERE thread_id = $1
          LIMIT 1`,
        [threadId]
    );
    if (!result.rows[0]) return null;
    const row = result.rows[0];
    return { key: row.queue_key, name: row.queue_name, size: row.size, description: row.description, lobby_display_name: row.lobby_display_name };
};

const loadAllLfgParticipants = async () => {
    const result = await executeQuery(
        'SELECT queue_key, participants FROM lfg_queues'
    );
    return result.rows;
};

const findLfgParticipantsByKey = async (key) => {
    const result = await executeQuery(
        'SELECT participants FROM lfg_queues WHERE queue_key = $1 ORDER BY updated_at DESC LIMIT 1',
        [key]
    );
    return result.rows[0]?.participants || [];
};

const upsertLfgQueue = async (threadId, queueDef, participants, status) => {
    await executeQuery(
        `INSERT INTO lfg_queues(thread_id, queue_key, queue_name, size, status, participants, updated_at)
         VALUES($1,$2,$3,$4,$5,$6,NOW())
         ON CONFLICT (thread_id) DO UPDATE SET queue_key=EXCLUDED.queue_key, queue_name=EXCLUDED.queue_name, size=EXCLUDED.size, status=EXCLUDED.status, participants=EXCLUDED.participants, updated_at=NOW()`,
        [threadId, queueDef.key, queueDef.name, queueDef.size, status, participants]
    );
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

const ensureInvitesSchema = async () => {
    await executeQuery(
        `ALTER TABLE invites ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`
    ).catch(() => {});
    await executeQuery(
        `ALTER TABLE invites ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`
    ).catch(() => {});
};

const insertInvite = async (command_user_id, invited_member_id, squad_name, message_id, tracking_message_id, squad_type, expiresAt) => {
    const query = `
        INSERT INTO invites (command_user_id, invited_member_id, squad_name, invite_status, message_id, tracking_message_id, squad_type, expires_at, created_at)
        VALUES ($1, $2, $3, 'Pending', $4, $5, $6, $7, NOW())
    `;
    await executeQuery(query, [command_user_id, invited_member_id, squad_name, message_id, tracking_message_id, squad_type, expiresAt || null]);
};

const fetchExpiredPendingInvites = async () => {
    const result = await executeQuery(
        `SELECT * FROM invites WHERE invite_status = 'Pending' AND expires_at IS NOT NULL AND expires_at <= NOW()`
    );
    return result.rows;
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

// Squad State
async function ensureSquadStateTable() {
    const query = `
        CREATE TABLE IF NOT EXISTS squad_state (
            key VARCHAR(255) PRIMARY KEY,
            value VARCHAR(1024),
            updated_at TIMESTAMP DEFAULT NOW()
        )
    `;
    return executeQuery(query);
}

async function getSquadState(key) {
    const query = 'SELECT value, updated_at FROM squad_state WHERE key = $1';
    const result = await executeQuery(query, [key]);
    return result.rows[0] || null;
}

async function setSquadState(key, value) {
    const query = `
        INSERT INTO squad_state (key, value, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
    `;
    return executeQuery(query, [key, value]);
}

// Transfer Requests
async function ensureTransferRequestsTable() {
    const query = `
        CREATE TABLE IF NOT EXISTS transfer_requests (
            id SERIAL PRIMARY KEY,
            leader_id VARCHAR(255) NOT NULL,
            target_id VARCHAR(255) NOT NULL,
            squad_name VARCHAR(255) NOT NULL,
            squad_type VARCHAR(50) NOT NULL,
            message_id VARCHAR(255),
            status VARCHAR(50) DEFAULT 'Pending',
            expires_at TIMESTAMP NOT NULL,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `;
    return executeQuery(query);
}

async function insertTransferRequest({ leaderId, targetId, squadName, squadType, messageId, expiresAt }) {
    const query = `
        INSERT INTO transfer_requests (leader_id, target_id, squad_name, squad_type, message_id, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
    `;
    const result = await executeQuery(query, [leaderId, targetId, squadName, squadType, messageId, expiresAt]);
    return result.rows[0];
}

async function fetchTransferRequestByMessageId(messageId) {
    const query = 'SELECT * FROM transfer_requests WHERE message_id = $1';
    const result = await executeQuery(query, [messageId]);
    return result.rows[0] || null;
}

async function updateTransferRequestStatus(messageId, status) {
    const query = 'UPDATE transfer_requests SET status = $1 WHERE message_id = $2';
    return executeQuery(query, [status, messageId]);
}

async function fetchExpiredPendingTransfers() {
    const query = "SELECT * FROM transfer_requests WHERE status = 'Pending' AND expires_at < NOW()";
    const result = await executeQuery(query);
    return result.rows;
}

const ensureLeagueActivitySchema = async () => {
    const columns = [
        { name: 'last_health_check', type: 'TIMESTAMPTZ' },
        { name: 'last_checkin_date', type: 'TIMESTAMPTZ' },
        { name: 'co_owner_1', type: 'TEXT' },
        { name: 'co_owner_2', type: 'TEXT' },
    ];
    for (const col of columns) {
        await executeQuery(
            `ALTER TABLE "Active Leagues" ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`
        ).catch(() => {});
    }

    await executeQuery(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_active_leagues_server_id
        ON "Active Leagues" (server_id)
        WHERE league_status = 'Active'
    `).catch(() => {});

    await executeQuery(`
        CREATE TABLE IF NOT EXISTS league_checkins (
            id SERIAL PRIMARY KEY,
            league_id INTEGER NOT NULL,
            owner_id BIGINT NOT NULL,
            checkin_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            activity_notes TEXT,
            checkin_month VARCHAR(7) NOT NULL
        )
    `);

    await executeQuery(`
        CREATE TABLE IF NOT EXISTS league_health_logs (
            id SERIAL PRIMARY KEY,
            league_id INTEGER NOT NULL,
            check_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            invite_valid BOOLEAN NOT NULL,
            member_count INTEGER,
            owner_in_guild BOOLEAN NOT NULL
        )
    `);
};

const fetchActiveLeagues = async () => {
    const result = await executeQuery(
        'SELECT * FROM "Active Leagues" WHERE league_status = $1',
        ['Active']
    );
    return result.rows;
};

const fetchAllLeaguesForCheckin = async () => {
    const result = await executeQuery(
        'SELECT * FROM "Active Leagues"'
    );
    return result.rows;
};

const fetchLeaguesByOwner = async (ownerId) => {
    const result = await executeQuery(
        'SELECT * FROM "Active Leagues" WHERE owner_id = $1',
        [ownerId]
    );
    return result.rows;
};

const insertLeagueHealthLog = async (leagueId, inviteValid, memberCount, ownerInGuild) => {
    await executeQuery(
        `INSERT INTO league_health_logs (league_id, invite_valid, member_count, owner_in_guild)
         VALUES ($1, $2, $3, $4)`,
        [leagueId, inviteValid, memberCount, ownerInGuild]
    );
};

const updateLeagueHealthData = async (leagueId, data) => {
    await executeQuery(
        `UPDATE "Active Leagues"
         SET server_name = $1, member_count = $2, server_icon = $3,
             server_banner = $4, vanity_url = $5, server_description = $6,
             server_features = $7, last_health_check = NOW()
         WHERE league_id = $8`,
        [data.serverName, data.memberCount, data.serverIcon, data.serverBanner,
         data.vanityUrl, data.serverDescription, data.serverFeatures, leagueId]
    );
};

const insertLeagueCheckin = async (leagueId, ownerId, activityNotes, checkinMonth) => {
    await executeQuery(
        `INSERT INTO league_checkins (league_id, owner_id, activity_notes, checkin_month)
         VALUES ($1, $2, $3, $4)`,
        [leagueId, ownerId, activityNotes, checkinMonth]
    );
};

const updateLeagueCheckinDate = async (leagueId) => {
    await executeQuery(
        `UPDATE "Active Leagues" SET last_checkin_date = NOW() WHERE league_id = $1`,
        [leagueId]
    );
};

const updateLeagueStatus = async (leagueId, status) => {
    await executeQuery(
        `UPDATE "Active Leagues" SET league_status = $1 WHERE league_id = $2`,
        [status, leagueId]
    );
};

const fetchCheckinForMonth = async (leagueId, checkinMonth) => {
    const result = await executeQuery(
        'SELECT * FROM league_checkins WHERE league_id = $1 AND checkin_month = $2',
        [leagueId, checkinMonth]
    );
    return result.rows;
};

const updateLeagueInvite = async (leagueId, invite, data) => {
    await executeQuery(
        `UPDATE "Active Leagues"
         SET league_invite = $1, server_name = $2, server_id = $3,
             member_count = $4, server_icon = $5, server_banner = $6,
             vanity_url = $7, server_description = $8, server_features = $9
         WHERE league_id = $10`,
        [invite, data.serverName, data.serverId, data.memberCount, data.serverIcon,
         data.serverBanner, data.vanityUrl, data.serverDescription, data.serverFeatures, leagueId]
    );
};

const fetchLeaguesByCoOwner = async (userId) => {
    const result = await executeQuery(
        'SELECT * FROM "Active Leagues" WHERE co_owner_1 = $1 OR co_owner_2 = $1',
        [userId]
    );
    return result.rows;
};

const isUserCoOwnerAnywhere = async (userId) => {
    const result = await executeQuery(
        'SELECT league_id FROM "Active Leagues" WHERE co_owner_1 = $1 OR co_owner_2 = $1 LIMIT 1',
        [userId]
    );
    return result.rows.length > 0;
};

const addCoOwner = async (leagueId, userId) => {
    const result = await executeQuery(
        'SELECT co_owner_1, co_owner_2 FROM "Active Leagues" WHERE league_id = $1',
        [leagueId]
    );
    const row = result.rows[0];
    if (!row) throw new Error('League not found');
    if (!row.co_owner_1) {
        await executeQuery(
            'UPDATE "Active Leagues" SET co_owner_1 = $1 WHERE league_id = $2',
            [userId, leagueId]
        );
    } else if (!row.co_owner_2) {
        await executeQuery(
            'UPDATE "Active Leagues" SET co_owner_2 = $1 WHERE league_id = $2',
            [userId, leagueId]
        );
    } else {
        throw new Error('Both co-owner slots are full');
    }
};

const removeCoOwner = async (leagueId, userId) => {
    const result = await executeQuery(
        'SELECT co_owner_1, co_owner_2 FROM "Active Leagues" WHERE league_id = $1',
        [leagueId]
    );
    const row = result.rows[0];
    if (!row) throw new Error('League not found');
    if (row.co_owner_1 === userId) {
        await executeQuery(
            'UPDATE "Active Leagues" SET co_owner_1 = NULL WHERE league_id = $1',
            [leagueId]
        );
    } else if (row.co_owner_2 === userId) {
        await executeQuery(
            'UPDATE "Active Leagues" SET co_owner_2 = NULL WHERE league_id = $1',
            [leagueId]
        );
    } else {
        throw new Error('User is not a co-owner of this league');
    }
};

module.exports = {
    executeQuery,
    removeRep,
    fetchTopUsersByReputation,
    insertCommandUsage,
    insertSquadApplication,
    fetchCommandUsageData,
    fetchSquadApplications,
    fetchSquadApplicationByMessageUrl,
    deleteSquadApplicationById,
    ensureInvitesSchema,
    insertInvite,
    fetchExpiredPendingInvites,
    deleteInvite,
    updateInviteStatus,
    fetchInviteById,
    updateUserReputation,
    closePool,
    pool,
    findOfficialApplication,
    insertOfficialApplication,
    deleteOfficialApplication,
    findLeagueApplication,
    updateLeagueApplicationApproval,
    updateLeagueApplicationDenial,
    findActiveLeague,
    findActiveLeagueByOwnerAndName,
    insertActiveLeague,
    updateActiveLeague,
    ensureLfgTable,
    findLfgParticipantQueues,
    updateLfgParticipants,
    findLfgQueueByKey,
    findLfgQueueByThreadId,
    loadAllLfgParticipants,
    findLfgParticipantsByKey,
    upsertLfgQueue,
    ensureSquadStateTable,
    getSquadState,
    setSquadState,
    ensureTransferRequestsTable,
    insertTransferRequest,
    fetchTransferRequestByMessageId,
    updateTransferRequestStatus,
    fetchExpiredPendingTransfers,
    ensureLeagueActivitySchema,
    fetchActiveLeagues,
    fetchAllLeaguesForCheckin,
    fetchLeaguesByOwner,
    insertLeagueHealthLog,
    updateLeagueHealthData,
    insertLeagueCheckin,
    updateLeagueCheckinDate,
    updateLeagueStatus,
    fetchCheckinForMonth,
    updateLeagueInvite,
    fetchLeaguesByCoOwner,
    isUserCoOwnerAnywhere,
    addCoOwner,
    removeCoOwner,
};
