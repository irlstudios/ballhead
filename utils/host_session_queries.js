'use strict';

// Database access for host EMH sessions. Kept out of db.js, which is already well
// past the project's file-size ceiling; utils/reports_queries.js is the precedent.
//
// Session state lives in Postgres rather than memory so a restart mid-event can
// resume the nudge loop and still produce a sheet row instead of silently losing
// the event and leaving the room renamed with activities open.

const { executeQuery } = require('../db');

const ensureHostSessionSchema = async () => {
    await executeQuery(`
        CREATE TABLE IF NOT EXISTS host_sessions (
            id BIGSERIAL PRIMARY KEY,
            guild_id TEXT NOT NULL,
            channel_id TEXT NOT NULL,
            host_id TEXT NOT NULL,
            host_name TEXT NOT NULL,
            original_name TEXT,
            activity_name TEXT,
            nudge_message_id TEXT,
            peak_concurrent INTEGER NOT NULL DEFAULT 0,
            started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            activity_started_at TIMESTAMPTZ,
            ended_at TIMESTAMPTZ,
            sheet_written BOOLEAN NOT NULL DEFAULT FALSE
        )
    `);
    await executeQuery(
        'ALTER TABLE host_sessions ADD COLUMN IF NOT EXISTS sheet_written BOOLEAN NOT NULL DEFAULT FALSE'
    ).catch(() => {});
    await executeQuery(`
        CREATE TABLE IF NOT EXISTS host_session_members (
            session_id BIGINT NOT NULL REFERENCES host_sessions(id) ON DELETE CASCADE,
            user_id TEXT NOT NULL,
            joined_at TIMESTAMPTZ,
            total_seconds INTEGER NOT NULL DEFAULT 0,
            join_count INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (session_id, user_id)
        )
    `);
    // One live session per room and per host, enforced by the database so a
    // double-click on the confirm button cannot open two overlapping sessions.
    await executeQuery(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_host_sessions_active_channel ON host_sessions (channel_id) WHERE ended_at IS NULL'
    ).catch(() => {});
    await executeQuery(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_host_sessions_active_host ON host_sessions (host_id) WHERE ended_at IS NULL'
    ).catch(() => {});
};

const mapSession = (row) => (row ? {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    hostId: row.host_id,
    hostName: row.host_name,
    originalName: row.original_name,
    activityName: row.activity_name,
    nudgeMessageId: row.nudge_message_id,
    peakConcurrent: row.peak_concurrent,
    startedAt: row.started_at,
    activityStartedAt: row.activity_started_at,
    endedAt: row.ended_at,
} : null);

// Returns null when a live session already exists for this room or host.
const createSession = async ({ guildId, channelId, hostId, hostName, originalName }) => {
    const result = await executeQuery(
        `INSERT INTO host_sessions (guild_id, channel_id, host_id, host_name, original_name)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [guildId, channelId, hostId, hostName, originalName]
    );
    return mapSession(result.rows[0]);
};

const getActiveSessionByChannel = async (channelId) => {
    const result = await executeQuery(
        'SELECT * FROM host_sessions WHERE channel_id = $1 AND ended_at IS NULL',
        [channelId]
    );
    return mapSession(result.rows[0]);
};

const getActiveSessionByHost = async (hostId) => {
    const result = await executeQuery(
        'SELECT * FROM host_sessions WHERE host_id = $1 AND ended_at IS NULL',
        [hostId]
    );
    return mapSession(result.rows[0]);
};

const listActiveSessions = async () => {
    const result = await executeQuery('SELECT * FROM host_sessions WHERE ended_at IS NULL');
    return result.rows.map(mapSession);
};

// Only the first activity wins: a host swapping games mid-event should not reset
// the clock every metric is measured against.
const markSessionLive = async ({ sessionId, activityName, at = new Date() }) => {
    const result = await executeQuery(
        `UPDATE host_sessions
            SET activity_started_at = $2, activity_name = $3
          WHERE id = $1 AND activity_started_at IS NULL AND ended_at IS NULL
        RETURNING *`,
        [sessionId, at, activityName]
    );
    return mapSession(result.rows[0]);
};

const setNudgeMessageId = async (sessionId, messageId) => {
    await executeQuery('UPDATE host_sessions SET nudge_message_id = $2 WHERE id = $1', [sessionId, messageId]);
};

const endSession = async (sessionId, at = new Date()) => {
    const result = await executeQuery(
        'UPDATE host_sessions SET ended_at = $2 WHERE id = $1 AND ended_at IS NULL RETURNING *',
        [sessionId, at]
    );
    return mapSession(result.rows[0]);
};

// Opening an interval is idempotent on joined_at: a member already marked present
// keeps their original timestamp, so a duplicate voice event cannot erase time.
const openMemberInterval = async ({ sessionId, userId, at = new Date() }) => {
    await executeQuery(
        `INSERT INTO host_session_members (session_id, user_id, joined_at, join_count)
         VALUES ($1, $2, $3, 1)
         ON CONFLICT (session_id, user_id) DO UPDATE
            SET joined_at = COALESCE(host_session_members.joined_at, EXCLUDED.joined_at),
                join_count = host_session_members.join_count
                    + CASE WHEN host_session_members.joined_at IS NULL THEN 1 ELSE 0 END`,
        [sessionId, userId, at]
    );
};

const closeMemberInterval = async ({ sessionId, userId, at = new Date() }) => {
    await executeQuery(
        `UPDATE host_session_members
            SET total_seconds = total_seconds + GREATEST(0, FLOOR(EXTRACT(EPOCH FROM ($3::timestamptz - joined_at)))::INTEGER),
                joined_at = NULL
          WHERE session_id = $1 AND user_id = $2 AND joined_at IS NOT NULL`,
        [sessionId, userId, at]
    );
};

// Closes every still-open interval at once, for session end.
const closeAllMemberIntervals = async ({ sessionId, at = new Date() }) => {
    await executeQuery(
        `UPDATE host_session_members
            SET total_seconds = total_seconds + GREATEST(0, FLOOR(EXTRACT(EPOCH FROM ($2::timestamptz - joined_at)))::INTEGER),
                joined_at = NULL
          WHERE session_id = $1 AND joined_at IS NOT NULL`,
        [sessionId, at]
    );
};

// Reconciles tracked members against who is actually in the room, closing the
// intervals of anyone who left while the bot was not watching. Members still
// present keep their original joined_at, so no time is lost or double counted.
const closeMemberIntervalsExcept = async ({ sessionId, presentUserIds = [], at = new Date() }) => {
    await executeQuery(
        `UPDATE host_session_members
            SET total_seconds = total_seconds + GREATEST(0, FLOOR(EXTRACT(EPOCH FROM ($3::timestamptz - joined_at)))::INTEGER),
                joined_at = NULL
          WHERE session_id = $1 AND joined_at IS NOT NULL AND NOT (user_id = ANY($2::text[]))`,
        [sessionId, presentUserIds, at]
    );
};

const recordPeakConcurrent = async (sessionId, concurrent) => {
    await executeQuery(
        'UPDATE host_sessions SET peak_concurrent = GREATEST(peak_concurrent, $2) WHERE id = $1',
        [sessionId, Math.max(0, Number(concurrent) || 0)]
    );
};

const markSheetWritten = async (sessionId) => {
    await executeQuery('UPDATE host_sessions SET sheet_written = TRUE WHERE id = $1', [sessionId]);
};

// Finished sessions whose row never reached the sheet, so a Sheets outage costs a
// delay rather than the session data. Sessions that never went live are excluded:
// they have nothing to report.
const listUnwrittenSessions = async () => {
    const result = await executeQuery(
        `SELECT * FROM host_sessions
          WHERE ended_at IS NOT NULL AND sheet_written = FALSE AND activity_started_at IS NOT NULL
          ORDER BY ended_at`
    );
    return result.rows.map(mapSession);
};

const listSessionMembers = async (sessionId) => {
    const result = await executeQuery(
        'SELECT user_id, total_seconds, join_count FROM host_session_members WHERE session_id = $1',
        [sessionId]
    );
    return result.rows.map((row) => ({
        userId: row.user_id,
        totalSeconds: Number(row.total_seconds) || 0,
        joinCount: Number(row.join_count) || 0,
    }));
};

module.exports = {
    ensureHostSessionSchema,
    createSession,
    getActiveSessionByChannel,
    getActiveSessionByHost,
    listActiveSessions,
    markSessionLive,
    setNudgeMessageId,
    endSession,
    openMemberInterval,
    closeMemberInterval,
    closeAllMemberIntervals,
    closeMemberIntervalsExcept,
    markSheetWritten,
    listUnwrittenSessions,
    recordPeakConcurrent,
    listSessionMembers,
};
