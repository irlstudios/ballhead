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

// FF Official application queries
const ensureFfOfficialApplicationsTable = async () => {
    await executeQuery(`
        CREATE TABLE IF NOT EXISTS ff_official_applications (
            discord_id TEXT PRIMARY KEY,
            discord_username TEXT NOT NULL,
            in_game_username TEXT NOT NULL,
            applicant_role TEXT NOT NULL,
            officiating_duration TEXT NOT NULL,
            understands_rules BOOLEAN NOT NULL,
            motivation TEXT NOT NULL,
            stats_link TEXT NOT NULL,
            application_url TEXT NOT NULL,
            submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
};

const findFfOfficialApplication = async (discordId) => {
    const result = await executeQuery(
        'SELECT * FROM ff_official_applications WHERE discord_id = $1',
        [discordId]
    );
    return result.rows;
};

const insertFfOfficialApplication = async (params) => {
    const {
        discordId,
        username,
        inGameUsername,
        currentRole,
        officiatingDuration,
        understandsRules,
        motivation,
        statsLink,
        applicationUrl,
    } = params;
    await executeQuery(
        `INSERT INTO ff_official_applications
         (discord_id, discord_username, in_game_username, applicant_role, officiating_duration, understands_rules, motivation, stats_link, application_url, submitted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
        [discordId, username, inGameUsername, currentRole, officiatingDuration, understandsRules, motivation, statsLink, applicationUrl]
    );
};

const deleteFfOfficialApplication = async (discordId) => {
    await executeQuery(
        'DELETE FROM ff_official_applications WHERE discord_id = $1',
        [discordId]
    );
};

// Game ideas metrics (durable tracking of forum threads + thread messages)
const ensureGameIdeasTables = async () => {
    await executeQuery(`
        CREATE TABLE IF NOT EXISTS game_ideas_threads (
            thread_id TEXT PRIMARY KEY,
            starter_id TEXT,
            name TEXT,
            url TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await executeQuery(`
        CREATE TABLE IF NOT EXISTS game_ideas_messages (
            message_id TEXT PRIMARY KEY,
            thread_id TEXT NOT NULL,
            author_id TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await executeQuery(
        'CREATE INDEX IF NOT EXISTS idx_game_ideas_threads_created_at ON game_ideas_threads (created_at)'
    ).catch(() => {});
    await executeQuery(
        'CREATE INDEX IF NOT EXISTS idx_game_ideas_messages_created_at ON game_ideas_messages (created_at)'
    ).catch(() => {});
    await executeQuery(
        'CREATE INDEX IF NOT EXISTS idx_game_ideas_messages_author ON game_ideas_messages (author_id)'
    ).catch(() => {});
};

const insertGameIdeasThread = async ({ threadId, starterId, name, url, createdAt }) => {
    await executeQuery(
        `INSERT INTO game_ideas_threads (thread_id, starter_id, name, url, created_at)
         VALUES ($1, $2, $3, $4, COALESCE($5, NOW()))
         ON CONFLICT (thread_id) DO NOTHING`,
        [threadId, starterId || null, name || null, url || null, createdAt || null]
    );
};

const insertGameIdeasMessage = async ({ messageId, threadId, authorId, createdAt }) => {
    await executeQuery(
        `INSERT INTO game_ideas_messages (message_id, thread_id, author_id, created_at)
         VALUES ($1, $2, $3, COALESCE($4, NOW()))
         ON CONFLICT (message_id) DO NOTHING`,
        [messageId, threadId, authorId, createdAt || null]
    );
};

const getGameIdeasSummary = async (start, end) => {
    const result = await executeQuery(
        `SELECT
            (SELECT COUNT(*) FROM game_ideas_threads WHERE created_at >= $1 AND created_at <= $2) AS thread_count,
            (SELECT COUNT(*) FROM game_ideas_messages WHERE created_at >= $1 AND created_at <= $2) AS message_count,
            (SELECT COUNT(DISTINCT author_id) FROM game_ideas_messages WHERE created_at >= $1 AND created_at <= $2) AS unique_participants`,
        [start, end]
    );
    const row = result.rows[0] || {};
    return {
        threadCount: parseInt(row.thread_count, 10) || 0,
        messageCount: parseInt(row.message_count, 10) || 0,
        uniqueParticipants: parseInt(row.unique_participants, 10) || 0,
    };
};

const fetchGameIdeasThreadsInRange = async (start, end) => {
    const result = await executeQuery(
        `SELECT thread_id, starter_id, name, url, created_at
         FROM game_ideas_threads
         WHERE created_at >= $1 AND created_at <= $2
         ORDER BY created_at ASC`,
        [start, end]
    );
    return result.rows;
};

// Top-5 community poll: post catalog (poll_posts) + per-user ranked picks (poll_votes).
const ensurePollTables = async () => {
    await executeQuery(`
        CREATE TABLE IF NOT EXISTS poll_posts (
            thread_id TEXT NOT NULL,
            board TEXT NOT NULL,
            title TEXT,
            url TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (thread_id, board)
        )
    `);
    await executeQuery(
        'CREATE INDEX IF NOT EXISTS idx_poll_posts_board ON poll_posts (board)'
    ).catch(() => {});
    await executeQuery(`
        CREATE TABLE IF NOT EXISTS poll_votes (
            user_id TEXT NOT NULL,
            board TEXT NOT NULL,
            thread_id TEXT NOT NULL,
            position SMALLINT NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (user_id, board, thread_id),
            UNIQUE (user_id, board, position)
        )
    `);
    await executeQuery(
        'CREATE INDEX IF NOT EXISTS idx_poll_votes_board_thread ON poll_votes (board, thread_id)'
    ).catch(() => {});
};

const upsertPollPost = async ({ threadId, board, title, url, createdAt }) => {
    await executeQuery(
        `INSERT INTO poll_posts (thread_id, board, title, url, created_at)
         VALUES ($1, $2, $3, $4, COALESCE($5, NOW()))
         ON CONFLICT (thread_id, board) DO UPDATE
             SET title = EXCLUDED.title, url = EXCLUDED.url`,
        [threadId, board, title || null, url || null, createdAt || null]
    );
};

// Remove any board rows for this thread that are not in the given list.
// boards = [] removes every row for the thread (e.g. thread deleted or de-tagged).
const deletePollPostBoardsExcept = async (threadId, boards) => {
    await executeQuery(
        'DELETE FROM poll_posts WHERE thread_id = $1 AND NOT (board = ANY($2::text[]))',
        [threadId, boards]
    );
};

const searchPollPosts = async (board, query, limit = 25) => {
    const q = (query || '').trim();
    const result = await executeQuery(
        `SELECT thread_id, title, url
         FROM poll_posts
         WHERE board = $1 AND ($2 = '' OR title ILIKE '%' || $2 || '%')
         ORDER BY (title ILIKE $2 || '%') DESC, created_at DESC
         LIMIT $3`,
        [board, q, limit]
    );
    return result.rows;
};

const getPollPostBoards = async (threadId) => {
    const result = await executeQuery(
        'SELECT board FROM poll_posts WHERE thread_id = $1',
        [threadId]
    );
    return result.rows.map((r) => r.board);
};

const getPollPostCount = async () => {
    const result = await executeQuery('SELECT COUNT(*) AS n FROM poll_posts');
    return parseInt(result.rows[0]?.n, 10) || 0;
};

const getUserBoardList = async (userId, board) => {
    const result = await executeQuery(
        `SELECT v.thread_id, p.title, p.url
         FROM poll_votes v
         LEFT JOIN poll_posts p ON p.thread_id = v.thread_id AND p.board = v.board
         WHERE v.user_id = $1 AND v.board = $2
         ORDER BY v.position ASC`,
        [userId, board]
    );
    return result.rows;
};

// Rewrite a user's whole list for one board in a single transaction: the list is
// small (<=5) and rewriting avoids fiddly position-swap SQL and the UNIQUE(position)
// races that piecemeal updates would hit.
const saveUserBoardList = async (userId, board, threadIds) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM poll_votes WHERE user_id = $1 AND board = $2', [userId, board]);
        for (let i = 0; i < threadIds.length; i++) {
            await client.query(
                'INSERT INTO poll_votes (user_id, board, thread_id, position) VALUES ($1, $2, $3, $4)',
                [userId, board, threadIds[i], i + 1]
            );
        }
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

const getLeaderboard = async (board, limit = 10) => {
    const result = await executeQuery(
        `SELECT v.thread_id, p.title, p.url,
                SUM(6 - v.position) AS points,
                COUNT(*) AS voters
         FROM poll_votes v
         JOIN poll_posts p ON p.thread_id = v.thread_id AND p.board = v.board
         WHERE v.board = $1
         GROUP BY v.thread_id, p.title, p.url
         ORDER BY points DESC, voters DESC, MIN(p.created_at) ASC
         LIMIT $2`,
        [board, limit]
    );
    return result.rows;
};

// Program role snapshots (durable "roles they had" record for moderation alerts)
// Captures the program roles a member currently holds so that, after a ban or
// leave, we can still tell whether the moderated user was a program member.
const ensureProgramRoleSnapshotTable = async () => {
    await executeQuery(`
        CREATE TABLE IF NOT EXISTS program_role_snapshots (
            user_id TEXT PRIMARY KEY,
            role_ids TEXT[] NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
};

const upsertProgramRoleSnapshot = async (userId, roleIds) => {
    await executeQuery(
        `INSERT INTO program_role_snapshots (user_id, role_ids, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (user_id) DO UPDATE SET role_ids = EXCLUDED.role_ids, updated_at = NOW()`,
        [userId, roleIds]
    );
};

const getProgramRoleSnapshot = async (userId) => {
    const result = await executeQuery(
        'SELECT user_id, role_ids, updated_at FROM program_role_snapshots WHERE user_id = $1',
        [userId]
    );
    const row = result.rows[0];
    if (!row) {
        return null;
    }
    return { userId: row.user_id, roleIds: row.role_ids || [], updatedAt: row.updated_at };
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
    // Disbanded leagues are soft-deleted: they keep their owner_id/server_id but
    // must not count as an existing league, otherwise the registration guards
    // wrongly block a user (or server) whose only league was disbanded.
    const query = key === 'owner_id'
        ? 'SELECT * FROM "Active Leagues" WHERE owner_id = $1 AND league_type = \'Base\' AND league_status <> \'Disbanded\''
        : `SELECT * FROM "Active Leagues" WHERE ${key} = $1 AND league_status <> 'Disbanded'`;
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
        `SELECT * FROM "Active Leagues"
         WHERE owner_id = $1 AND league_status <> 'Disbanded'`,
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

const markLeagueDisbanded = async (leagueId, ownerId) => {
    const result = await executeQuery(
        `UPDATE "Active Leagues"
         SET league_status = 'Disbanded', co_owner_1 = NULL, co_owner_2 = NULL
         WHERE league_id = $1 AND owner_id = $2 AND league_status <> 'Disbanded'
         RETURNING league_id`,
        [leagueId, ownerId]
    );
    return result.rowCount > 0;
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
        `SELECT * FROM "Active Leagues"
         WHERE (co_owner_1 = $1 OR co_owner_2 = $1) AND league_status <> 'Disbanded'`,
        [userId]
    );
    return result.rows;
};

const isUserCoOwnerAnywhere = async (userId) => {
    const result = await executeQuery(
        `SELECT league_id FROM "Active Leagues"
         WHERE (co_owner_1 = $1 OR co_owner_2 = $1) AND league_status <> 'Disbanded'
         LIMIT 1`,
        [userId]
    );
    return result.rows.length > 0;
};

const addCoOwner = async (leagueId, userId) => {
    const result1 = await executeQuery(
        `UPDATE "Active Leagues" SET co_owner_1 = $1
         WHERE league_id = $2 AND co_owner_1 IS NULL
         RETURNING league_id`,
        [userId, leagueId]
    );
    if (result1.rows.length > 0) return;

    const result2 = await executeQuery(
        `UPDATE "Active Leagues" SET co_owner_2 = $1
         WHERE league_id = $2 AND co_owner_2 IS NULL
         RETURNING league_id`,
        [userId, leagueId]
    );
    if (result2.rows.length > 0) return;

    throw new Error('Both co-owner slots are full');
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

// ---------------------------------------------------------------------------
// Re-engagement system
// ---------------------------------------------------------------------------

// Tracks every outreach contact and every response, plus a global opt-out list.
// The UNIQUE (user_id, program, last_active_season) constraint on the outreach
// table is what guarantees a member is contacted at most once per lapse.
const ensureReengagementTables = async () => {
    await executeQuery(`
        CREATE TABLE IF NOT EXISTS reengagement_outreach (
            id SERIAL PRIMARY KEY,
            user_id TEXT NOT NULL,
            program TEXT NOT NULL,
            in_game_name TEXT,
            last_active_season INTEGER,
            lapsed_seasons INTEGER,
            status TEXT NOT NULL,
            message_id TEXT,
            error TEXT,
            sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (user_id, program, last_active_season)
        )
    `);
    await executeQuery(`
        CREATE TABLE IF NOT EXISTS reengagement_responses (
            id SERIAL PRIMARY KEY,
            user_id TEXT NOT NULL,
            program TEXT NOT NULL,
            response TEXT NOT NULL,
            reason TEXT,
            would_return TEXT,
            comments TEXT,
            responded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await executeQuery(`
        CREATE TABLE IF NOT EXISTS reengagement_optout (
            user_id TEXT PRIMARY KEY,
            opted_out_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
};

// Reserves a contact row before the DM is sent. Relies on the UNIQUE constraint:
// ON CONFLICT DO NOTHING means a second attempt for the same lapse is a no-op and
// returns no row, so the caller knows not to send again. Returns the new row id
// or null when the contact already existed.
const reserveReengagementOutreach = async ({ userId, program, inGameName, lastActiveSeason, lapsedSeasons }) => {
    const result = await executeQuery(
        `INSERT INTO reengagement_outreach
            (user_id, program, in_game_name, last_active_season, lapsed_seasons, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')
         ON CONFLICT (user_id, program, last_active_season) DO NOTHING
         RETURNING id`,
        [userId, program, inGameName, lastActiveSeason, lapsedSeasons]
    );
    return result.rows[0]?.id ?? null;
};

const updateReengagementOutreachStatus = async (id, status, { messageId = null, error = null } = {}) => {
    await executeQuery(
        `UPDATE reengagement_outreach
            SET status = $2, message_id = $3, error = $4
          WHERE id = $1`,
        [id, status, messageId, error]
    );
};

// Most recent outreach row for a user+program, used to enrich a staff note
// (their in-game name and which season they last played) when they respond.
const getLatestReengagementOutreach = async (userId, program) => {
    const result = await executeQuery(
        `SELECT user_id, program, in_game_name, last_active_season, lapsed_seasons
           FROM reengagement_outreach
          WHERE user_id = $1 AND program = $2
          ORDER BY sent_at DESC
          LIMIT 1`,
        [userId, program]
    );
    return result.rows[0] || null;
};

const insertReengagementResponse = async ({ userId, program, response, reason = null, wouldReturn = null, comments = null }) => {
    await executeQuery(
        `INSERT INTO reengagement_responses
            (user_id, program, response, reason, would_return, comments)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, program, response, reason, wouldReturn, comments]
    );
};

// Removes a user's outreach history so they become eligible for a fresh contact.
// Intended for the test harness; the once-per-lapse guard otherwise prevents
// re-sending to the same person for the same lapse.
const deleteReengagementOutreach = async (userId) => {
    const result = await executeQuery(
        'DELETE FROM reengagement_outreach WHERE user_id = $1',
        [userId]
    );
    return result.rowCount;
};

const isOptedOutOfReengagement = async (userId) => {
    const result = await executeQuery(
        'SELECT 1 FROM reengagement_optout WHERE user_id = $1',
        [userId]
    );
    return result.rows.length > 0;
};

const optOutOfReengagement = async (userId) => {
    await executeQuery(
        `INSERT INTO reengagement_optout (user_id)
         VALUES ($1)
         ON CONFLICT (user_id) DO NOTHING`,
        [userId]
    );
};

// ---------------------------------------------------------------------------
// League officials + games (Phase 2)
// ---------------------------------------------------------------------------

// Staff-managed roster of assignable officials, the request lifecycle, the
// post-game report, and the verified-game records. Two UNIQUE backstops
// (report per request, verified game per request) guarantee the games-played
// metric can never be inflated past the app's atomic status transitions.
const ensureLeagueOfficialsSchema = async () => {
    await executeQuery(`
        CREATE TABLE IF NOT EXISTS league_officials_roster (
            discord_id TEXT PRIMARY KEY,
            discord_name TEXT,
            sport TEXT NOT NULL DEFAULT 'Any',
            added_by TEXT,
            added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            active BOOLEAN NOT NULL DEFAULT TRUE
        )
    `);

    await executeQuery(`
        CREATE TABLE IF NOT EXISTS league_official_requests (
            id SERIAL PRIMARY KEY,
            league_id INTEGER NOT NULL,
            requested_by TEXT NOT NULL,
            sport TEXT,
            match_details TEXT,
            proposed_time TEXT,
            status TEXT NOT NULL DEFAULT 'Pending',
            assigned_official_id TEXT,
            assigned_by TEXT,
            assigned_at TIMESTAMPTZ,
            denial_reason TEXT,
            denied_by TEXT,
            ops_message_id TEXT,
            completed_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await executeQuery('CREATE INDEX IF NOT EXISTS idx_league_official_requests_league ON league_official_requests (league_id)').catch(() => {});
    await executeQuery('CREATE INDEX IF NOT EXISTS idx_league_official_requests_status ON league_official_requests (status)').catch(() => {});
    await executeQuery('CREATE INDEX IF NOT EXISTS idx_league_official_requests_ops ON league_official_requests (ops_message_id)').catch(() => {});

    await executeQuery(`
        CREATE TABLE IF NOT EXISTS league_game_reports (
            id SERIAL PRIMARY KEY,
            request_id INTEGER NOT NULL,
            league_id INTEGER NOT NULL,
            official_id TEXT NOT NULL,
            proof_url TEXT NOT NULL,
            rules_doc_url TEXT,
            score TEXT,
            notes TEXT,
            submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await executeQuery('CREATE UNIQUE INDEX IF NOT EXISTS idx_game_reports_request ON league_game_reports (request_id)').catch(() => {});

    await executeQuery(`
        CREATE TABLE IF NOT EXISTS league_games (
            id SERIAL PRIMARY KEY,
            league_id INTEGER NOT NULL,
            request_id INTEGER,
            sport TEXT,
            verification_status TEXT NOT NULL,
            verified_by TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    // Partial unique: at most one verified game per official request. Manually
    // entered games (no request) are exempt so a future manual-entry path works.
    await executeQuery('CREATE UNIQUE INDEX IF NOT EXISTS idx_league_games_request ON league_games (request_id) WHERE request_id IS NOT NULL').catch(() => {});
    await executeQuery('CREATE INDEX IF NOT EXISTS idx_league_games_league_status ON league_games (league_id, verification_status)').catch(() => {});
};

const fetchLeagueById = async (leagueId) => {
    const result = await executeQuery('SELECT * FROM "Active Leagues" WHERE league_id = $1', [leagueId]);
    return result.rows[0] || null;
};

// --- roster ---

const addRosterOfficial = async ({ discordId, discordName, sport, addedBy }) => {
    await executeQuery(
        `INSERT INTO league_officials_roster (discord_id, discord_name, sport, added_by, active)
         VALUES ($1, $2, $3, $4, TRUE)
         ON CONFLICT (discord_id) DO UPDATE
             SET discord_name = EXCLUDED.discord_name,
                 sport = EXCLUDED.sport,
                 added_by = EXCLUDED.added_by,
                 active = TRUE`,
        [discordId, discordName || null, sport || 'Any', addedBy || null]
    );
};

const removeRosterOfficial = async (discordId) => {
    const result = await executeQuery(
        'UPDATE league_officials_roster SET active = FALSE WHERE discord_id = $1 AND active = TRUE RETURNING discord_id',
        [discordId]
    );
    return result.rowCount > 0;
};

const listRosterOfficials = async () => {
    const result = await executeQuery(
        `SELECT discord_id, discord_name, sport, added_by, added_at
         FROM league_officials_roster WHERE active = TRUE ORDER BY added_at ASC`
    );
    return result.rows;
};

// Officials offerable for a request's sport: active, and sport 'Any'/empty or a
// case-insensitive match. Capped at Discord's 25-option select limit.
const fetchAvailableOfficials = async (sport) => {
    const result = await executeQuery(
        `SELECT discord_id, discord_name, sport
         FROM league_officials_roster
         WHERE active = TRUE
           AND (COALESCE(NULLIF(TRIM(sport), ''), 'Any') ILIKE 'Any' OR sport ILIKE $1)
         ORDER BY added_at ASC
         LIMIT 25`,
        [(sport || '').trim()]
    );
    return result.rows;
};

// --- requests ---

const countOpenOfficialRequests = async (leagueId) => {
    const result = await executeQuery(
        `SELECT COUNT(*)::int AS n FROM league_official_requests
         WHERE league_id = $1 AND status IN ('Pending', 'Assigned')`,
        [leagueId]
    );
    return result.rows[0]?.n ?? 0;
};

const insertOfficialRequest = async ({ leagueId, requestedBy, sport, matchDetails, proposedTime }) => {
    const result = await executeQuery(
        `INSERT INTO league_official_requests (league_id, requested_by, sport, match_details, proposed_time, status)
         VALUES ($1, $2, $3, $4, $5, 'Pending') RETURNING *`,
        [leagueId, requestedBy, sport || null, matchDetails || null, proposedTime || null]
    );
    return result.rows[0];
};

const setOfficialRequestOpsMessage = async (id, opsMessageId) => {
    await executeQuery(
        'UPDATE league_official_requests SET ops_message_id = $1 WHERE id = $2',
        [opsMessageId, id]
    );
};

// Compensating delete: if posting the ops card fails after insert, remove the
// orphan request so it does not silently consume the open-request cap.
const deleteOfficialRequest = async (id) => {
    await executeQuery('DELETE FROM league_official_requests WHERE id = $1', [id]);
};

const fetchOfficialRequestById = async (id) => {
    const result = await executeQuery('SELECT * FROM league_official_requests WHERE id = $1', [id]);
    return result.rows[0] || null;
};

const fetchOfficialRequestByOpsMessage = async (opsMessageId) => {
    const result = await executeQuery('SELECT * FROM league_official_requests WHERE ops_message_id = $1', [opsMessageId]);
    return result.rows[0] || null;
};

// Atomic assign: only a still-Pending request can be claimed. Two staff racing
// both run this; the loser gets no row back and is told it was already handled.
const assignOfficialRequest = async (id, officialId, assignedBy) => {
    const result = await executeQuery(
        `UPDATE league_official_requests
         SET status = 'Assigned', assigned_official_id = $2, assigned_by = $3, assigned_at = NOW()
         WHERE id = $1 AND status = 'Pending'
         RETURNING *`,
        [id, officialId, assignedBy]
    );
    return result.rows[0] || null;
};

// Atomic deny: only an open (Pending/Assigned) request can be denied.
const denyOfficialRequest = async (id, reason, deniedBy) => {
    const result = await executeQuery(
        `UPDATE league_official_requests
         SET status = 'Denied', denial_reason = $2, denied_by = $3
         WHERE id = $1 AND status IN ('Pending', 'Assigned')
         RETURNING *`,
        [id, reason || null, deniedBy]
    );
    return result.rows[0] || null;
};

// --- report + verified game (single atomic transaction) ---

// Records the assigned official's post-game report and the verified game, and
// flips the request to Completed, in one transaction. The completion UPDATE is
// the claim: a double-click or a second assigned official loses the WHERE
// status='Assigned' race and the whole thing rolls back. Returns the completed
// request row, or null if the claim was lost.
const completeOfficialRequestWithReport = async (id, officialId, report) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const claim = await client.query(
            `UPDATE league_official_requests
             SET status = 'Completed', completed_at = NOW()
             WHERE id = $1 AND status = 'Assigned' AND assigned_official_id = $2
             RETURNING *`,
            [id, officialId]
        );
        if (claim.rowCount === 0) {
            await client.query('ROLLBACK');
            return null;
        }
        const request = claim.rows[0];
        await client.query(
            `INSERT INTO league_game_reports (request_id, league_id, official_id, proof_url, rules_doc_url, score, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [id, request.league_id, officialId, report.proofUrl, report.rulesDocUrl || null, report.score || null, report.notes || null]
        );
        await client.query(
            `INSERT INTO league_games (league_id, request_id, sport, verification_status, verified_by)
             VALUES ($1, $2, $3, $4, $5)`,
            [request.league_id, id, request.sport || null, 'Official Verified', officialId]
        );
        await client.query('COMMIT');
        return request;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

const getLeagueGamesSummary = async (leagueId) => {
    const result = await executeQuery(
        `SELECT
            (SELECT COUNT(*)::int FROM league_games
                WHERE league_id = $1 AND verification_status IN ('Official Verified', 'Staff Verified')) AS verified,
            (SELECT COUNT(*)::int FROM league_game_reports WHERE league_id = $1) AS reported`,
        [leagueId]
    );
    const row = result.rows[0] || {};
    return { verified: row.verified ?? 0, reported: row.reported ?? 0 };
};

const fetchRecentLeagueGames = async (leagueId, limit = 10) => {
    const result = await executeQuery(
        `SELECT id, sport, verification_status, created_at
         FROM league_games WHERE league_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [leagueId, limit]
    );
    return result.rows;
};

// ---------------------------------------------------------------------------
// League content + views (Phase 3)
// ---------------------------------------------------------------------------

const ensureLeagueContentSchema = async () => {
    const columns = [
        { name: 'sport', type: 'TEXT' },
        { name: 'league_hashtag', type: 'TEXT' },
        { name: 'content_tracking_enabled', type: 'BOOLEAN NOT NULL DEFAULT FALSE' },
    ];
    for (const col of columns) {
        await executeQuery(`ALTER TABLE "Active Leagues" ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`).catch(() => {});
    }
    // A hashtag, once set, is unique across leagues. Partial so many leagues can
    // share a NULL hashtag.
    await executeQuery('CREATE UNIQUE INDEX IF NOT EXISTS idx_active_leagues_hashtag ON "Active Leagues" (LOWER(league_hashtag)) WHERE league_hashtag IS NOT NULL').catch(() => {});

    await executeQuery(`
        CREATE TABLE IF NOT EXISTS league_content_submissions (
            id SERIAL PRIMARY KEY,
            league_id INTEGER NOT NULL,
            submitted_by TEXT NOT NULL,
            url TEXT NOT NULL,
            platform TEXT,
            title TEXT,
            latest_views INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await executeQuery('CREATE INDEX IF NOT EXISTS idx_league_content_league ON league_content_submissions (league_id)').catch(() => {});
};

// Sets sport and/or hashtag; passing null for a field keeps the existing value.
// content_tracking_enabled tracks whether a hashtag is set. Throws Postgres
// 23505 on a duplicate hashtag so the caller can report it.
const updateLeagueContentSettings = async (leagueId, { sport = null, hashtag = null }) => {
    await executeQuery(
        `UPDATE "Active Leagues"
         SET sport = COALESCE($2, sport),
             league_hashtag = COALESCE($3, league_hashtag),
             content_tracking_enabled = (COALESCE($3, league_hashtag) IS NOT NULL)
         WHERE league_id = $1`,
        [leagueId, sport, hashtag]
    );
};

const insertContentSubmission = async ({ leagueId, submittedBy, url, platform, title }) => {
    const result = await executeQuery(
        `INSERT INTO league_content_submissions (league_id, submitted_by, url, platform, title)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [leagueId, submittedBy, url, platform || null, title || null]
    );
    return result.rows[0];
};

const fetchLeagueContent = async (leagueId, limit = 10) => {
    const result = await executeQuery(
        `SELECT id, url, platform, title, latest_views, created_at
         FROM league_content_submissions WHERE league_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [leagueId, limit]
    );
    return result.rows;
};

const getLeagueContentSummary = async (leagueId) => {
    const result = await executeQuery(
        `SELECT COUNT(*)::int AS count, COALESCE(SUM(latest_views), 0)::int AS total_views
         FROM league_content_submissions WHERE league_id = $1`,
        [leagueId]
    );
    const row = result.rows[0] || {};
    return { count: row.count ?? 0, totalViews: row.total_views ?? 0 };
};

// ---------------------------------------------------------------------------
// League enforcement: strikes + appeals (Phase 4)
// ---------------------------------------------------------------------------

const ensureLeagueEnforcementSchema = async () => {
    await executeQuery('ALTER TABLE "Active Leagues" ADD COLUMN IF NOT EXISTS health_status TEXT NOT NULL DEFAULT \'Healthy\'').catch(() => {});

    await executeQuery(`
        CREATE TABLE IF NOT EXISTS league_strikes (
            id SERIAL PRIMARY KEY,
            league_id INTEGER NOT NULL,
            reason TEXT NOT NULL,
            issued_by TEXT NOT NULL,
            active BOOLEAN NOT NULL DEFAULT TRUE,
            resolved_by TEXT,
            resolved_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await executeQuery('CREATE INDEX IF NOT EXISTS idx_league_strikes_league ON league_strikes (league_id, active)').catch(() => {});

    await executeQuery(`
        CREATE TABLE IF NOT EXISTS league_appeals (
            id SERIAL PRIMARY KEY,
            strike_id INTEGER NOT NULL,
            league_id INTEGER NOT NULL,
            submitted_by TEXT NOT NULL,
            statement TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'Pending',
            reviewed_by TEXT,
            review_notes TEXT,
            ops_message_id TEXT,
            reviewed_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await executeQuery('CREATE INDEX IF NOT EXISTS idx_league_appeals_strike ON league_appeals (strike_id)').catch(() => {});
    await executeQuery('CREATE INDEX IF NOT EXISTS idx_league_appeals_ops ON league_appeals (ops_message_id)').catch(() => {});
    // Backstop for the check-then-insert in /league-appeal: at most one pending
    // appeal per strike, even under concurrent submissions.
    await executeQuery(`CREATE UNIQUE INDEX IF NOT EXISTS idx_league_appeals_pending
        ON league_appeals (strike_id) WHERE status = 'Pending'`).catch(() => {});
};

const deleteAppeal = async (appealId) => {
    await executeQuery('DELETE FROM league_appeals WHERE id = $1', [appealId]);
};

const insertStrike = async ({ leagueId, reason, issuedBy }) => {
    const result = await executeQuery(
        'INSERT INTO league_strikes (league_id, reason, issued_by) VALUES ($1, $2, $3) RETURNING *',
        [leagueId, reason, issuedBy]
    );
    return result.rows[0];
};

const countActiveStrikes = async (leagueId) => {
    const result = await executeQuery(
        'SELECT COUNT(*)::int AS n FROM league_strikes WHERE league_id = $1 AND active = TRUE',
        [leagueId]
    );
    return result.rows[0]?.n ?? 0;
};

const fetchActiveStrikes = async (leagueId) => {
    const result = await executeQuery(
        'SELECT id, reason, issued_by, created_at FROM league_strikes WHERE league_id = $1 AND active = TRUE ORDER BY created_at ASC',
        [leagueId]
    );
    return result.rows;
};

const fetchStrikeById = async (strikeId) => {
    const result = await executeQuery('SELECT * FROM league_strikes WHERE id = $1', [strikeId]);
    return result.rows[0] || null;
};

// Atomic resolve: only a still-active strike flips. Returns the row or null.
const resolveStrike = async (strikeId, resolvedBy) => {
    const result = await executeQuery(
        `UPDATE league_strikes SET active = FALSE, resolved_by = $2, resolved_at = NOW()
         WHERE id = $1 AND active = TRUE RETURNING *`,
        [strikeId, resolvedBy]
    );
    return result.rows[0] || null;
};

const setLeagueHealthStatus = async (leagueId, status) => {
    await executeQuery('UPDATE "Active Leagues" SET health_status = $2 WHERE league_id = $1', [leagueId, status]);
};

const hasPendingAppealForStrike = async (strikeId) => {
    const result = await executeQuery(
        `SELECT 1 FROM league_appeals
         WHERE strike_id = $1 AND status = 'Pending' LIMIT 1`,
        [strikeId]
    );
    return result.rows.length > 0;
};

const insertAppeal = async ({ strikeId, leagueId, submittedBy, statement }) => {
    const result = await executeQuery(
        'INSERT INTO league_appeals (strike_id, league_id, submitted_by, statement) VALUES ($1, $2, $3, $4) RETURNING *',
        [strikeId, leagueId, submittedBy, statement]
    );
    return result.rows[0];
};

const setAppealOpsMessage = async (appealId, opsMessageId) => {
    await executeQuery('UPDATE league_appeals SET ops_message_id = $1 WHERE id = $2', [opsMessageId, appealId]);
};

const fetchAppealById = async (appealId) => {
    const result = await executeQuery('SELECT * FROM league_appeals WHERE id = $1', [appealId]);
    return result.rows[0] || null;
};

// Atomic appeal resolution: only a still-Pending appeal transitions.
const resolveAppeal = async (appealId, status, reviewedBy, notes) => {
    const result = await executeQuery(
        `UPDATE league_appeals SET status = $2, reviewed_by = $3, review_notes = $4, reviewed_at = NOW()
         WHERE id = $1 AND status = 'Pending' RETURNING *`,
        [appealId, status, reviewedBy, notes || null]
    );
    return result.rows[0] || null;
};

// Accepting an appeal must lift its strike atomically: marking the appeal
// Accepted and clearing the strike happen in one transaction so a failure can
// never leave an accepted appeal with a still-active strike. Returns the appeal
// row, or null if it was no longer pending (lost the claim).
const acceptAppealAndLiftStrike = async (appealId, reviewerId) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const appealRes = await client.query(
            `UPDATE league_appeals SET status = 'Accepted', reviewed_by = $2, reviewed_at = NOW()
             WHERE id = $1 AND status = 'Pending' RETURNING *`,
            [appealId, reviewerId]
        );
        if (appealRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return null;
        }
        const appeal = appealRes.rows[0];
        await client.query(
            `UPDATE league_strikes SET active = FALSE, resolved_by = $2, resolved_at = NOW()
             WHERE id = $1 AND active = TRUE`,
            [appeal.strike_id, reviewerId]
        );
        await client.query('COMMIT');
        return appeal;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

// ---------------------------------------------------------------------------
// League reward requests (Phase 5) + directory
// ---------------------------------------------------------------------------

const ensureLeagueRewardsSchema = async () => {
    // reward_poc_id names which owner/co-owner handles rewards for a Sponsored
    // league; intake still allows any owner/co-owner in V1.
    await executeQuery('ALTER TABLE "Active Leagues" ADD COLUMN IF NOT EXISTS reward_poc_id TEXT').catch(() => {});

    await executeQuery(`
        CREATE TABLE IF NOT EXISTS league_reward_requests (
            id SERIAL PRIMARY KEY,
            league_id INTEGER NOT NULL,
            requested_by TEXT NOT NULL,
            reward_type TEXT NOT NULL,
            details TEXT,
            status TEXT NOT NULL DEFAULT 'Pending',
            external_fulfillment_status TEXT NOT NULL DEFAULT 'None',
            reviewed_by TEXT,
            review_notes TEXT,
            ops_message_id TEXT,
            reviewed_at TIMESTAMPTZ,
            fulfilled_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await executeQuery('CREATE INDEX IF NOT EXISTS idx_league_rewards_league ON league_reward_requests (league_id)').catch(() => {});
    await executeQuery('CREATE INDEX IF NOT EXISTS idx_league_rewards_ops ON league_reward_requests (ops_message_id)').catch(() => {});
};

const setRewardPoc = async (leagueId, userId) => {
    await executeQuery('UPDATE "Active Leagues" SET reward_poc_id = $2 WHERE league_id = $1', [leagueId, userId]);
};

const countRewardRequestsThisMonth = async (leagueId, month) => {
    const result = await executeQuery(
        `SELECT COUNT(*)::int AS n FROM league_reward_requests
         WHERE league_id = $1 AND to_char(created_at, 'YYYY-MM') = $2`,
        [leagueId, month]
    );
    return result.rows[0]?.n ?? 0;
};

const insertRewardRequest = async ({ leagueId, requestedBy, rewardType, details }) => {
    const result = await executeQuery(
        `INSERT INTO league_reward_requests (league_id, requested_by, reward_type, details)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [leagueId, requestedBy, rewardType, details || null]
    );
    return result.rows[0];
};

const setRewardOpsMessage = async (id, opsMessageId) => {
    await executeQuery('UPDATE league_reward_requests SET ops_message_id = $1 WHERE id = $2', [opsMessageId, id]);
};

// Compensating delete: remove an orphan reward request if the ops card fails to
// post, so it does not consume the monthly cap invisibly.
const deleteRewardRequest = async (id) => {
    await executeQuery('DELETE FROM league_reward_requests WHERE id = $1', [id]);
};

const fetchRewardRequestById = async (id) => {
    const result = await executeQuery('SELECT * FROM league_reward_requests WHERE id = $1', [id]);
    return result.rows[0] || null;
};

// Atomic approve/deny: only a still-Pending request transitions. fulfillment is
// the external_fulfillment_status to set (e.g. 'Awaiting Fulfillment' on approve).
const resolveRewardRequest = async (id, status, reviewedBy, notes, fulfillment) => {
    const result = await executeQuery(
        `UPDATE league_reward_requests
         SET status = $2, external_fulfillment_status = $3, reviewed_by = $4, review_notes = $5, reviewed_at = NOW()
         WHERE id = $1 AND status = 'Pending' RETURNING *`,
        [id, status, fulfillment, reviewedBy, notes || null]
    );
    return result.rows[0] || null;
};

// Atomic fulfil: only an Approved request can be marked fulfilled.
const markRewardFulfilled = async (id, fulfilledBy) => {
    const result = await executeQuery(
        `UPDATE league_reward_requests
         SET status = 'Fulfilled', external_fulfillment_status = 'Fulfilled', reviewed_by = COALESCE(reviewed_by, $2), fulfilled_at = NOW()
         WHERE id = $1 AND status = 'Approved' RETURNING *`,
        [id, fulfilledBy]
    );
    return result.rows[0] || null;
};

// Public directory: active leagues grouped Sponsored -> Active -> Base.
const fetchLeaguesForDirectory = async () => {
    const result = await executeQuery(
        `SELECT league_name, league_type, health_status, league_invite, member_count
         FROM "Active Leagues"
         WHERE league_status = 'Active'
         ORDER BY CASE league_type WHEN 'Sponsored' THEN 0 WHEN 'Active' THEN 1 WHEN 'Base' THEN 2 ELSE 3 END,
                  member_count DESC NULLS LAST, league_name ASC`
    );
    return result.rows;
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
    ensureFfOfficialApplicationsTable,
    findFfOfficialApplication,
    insertFfOfficialApplication,
    deleteFfOfficialApplication,
    ensureGameIdeasTables,
    insertGameIdeasThread,
    insertGameIdeasMessage,
    getGameIdeasSummary,
    fetchGameIdeasThreadsInRange,
    ensureProgramRoleSnapshotTable,
    upsertProgramRoleSnapshot,
    getProgramRoleSnapshot,
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
    markLeagueDisbanded,
    fetchCheckinForMonth,
    updateLeagueInvite,
    fetchLeaguesByCoOwner,
    isUserCoOwnerAnywhere,
    addCoOwner,
    removeCoOwner,
    ensureReengagementTables,
    reserveReengagementOutreach,
    updateReengagementOutreachStatus,
    getLatestReengagementOutreach,
    deleteReengagementOutreach,
    insertReengagementResponse,
    isOptedOutOfReengagement,
    optOutOfReengagement,
    ensurePollTables,
    upsertPollPost,
    deletePollPostBoardsExcept,
    searchPollPosts,
    getPollPostBoards,
    getPollPostCount,
    getUserBoardList,
    saveUserBoardList,
    getLeaderboard,
    ensureLeagueOfficialsSchema,
    fetchLeagueById,
    addRosterOfficial,
    removeRosterOfficial,
    listRosterOfficials,
    fetchAvailableOfficials,
    countOpenOfficialRequests,
    insertOfficialRequest,
    setOfficialRequestOpsMessage,
    deleteOfficialRequest,
    fetchOfficialRequestById,
    fetchOfficialRequestByOpsMessage,
    assignOfficialRequest,
    denyOfficialRequest,
    completeOfficialRequestWithReport,
    getLeagueGamesSummary,
    fetchRecentLeagueGames,
    ensureLeagueContentSchema,
    updateLeagueContentSettings,
    insertContentSubmission,
    fetchLeagueContent,
    getLeagueContentSummary,
    ensureLeagueEnforcementSchema,
    insertStrike,
    countActiveStrikes,
    fetchActiveStrikes,
    fetchStrikeById,
    resolveStrike,
    setLeagueHealthStatus,
    hasPendingAppealForStrike,
    insertAppeal,
    setAppealOpsMessage,
    fetchAppealById,
    resolveAppeal,
    acceptAppealAndLiftStrike,
    deleteAppeal,
    ensureLeagueRewardsSchema,
    setRewardPoc,
    countRewardRequestsThisMonth,
    insertRewardRequest,
    setRewardOpsMessage,
    deleteRewardRequest,
    fetchRewardRequestById,
    resolveRewardRequest,
    markRewardFulfilled,
    fetchLeaguesForDirectory,
};
