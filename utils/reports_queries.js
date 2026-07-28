'use strict';

// Database access for player reports. Kept out of db.js, which is already well
// past the project's file-size ceiling; utils/squad_queries.js is the precedent
// for a feature-scoped query module.

const { executeQuery } = require('../db');

// reported_key is generated rather than written by the app so that repeat-offender
// grouping can never drift from the display name the reporter typed.
// reporter_id and rule_broken are nullable only because of the backfill: a report
// actioned before indexing had its buttons stripped, and the reporter ID lived in
// those buttons. New reports always carry both.
const ensurePlayerReportsSchema = async () => {
    await executeQuery(`
        CREATE TABLE IF NOT EXISTS player_reports (
            ref_id TEXT PRIMARY KEY,
            reporter_id TEXT,
            reporter_tag TEXT,
            reported_name TEXT NOT NULL,
            reported_key TEXT GENERATED ALWAYS AS (lower(btrim(reported_name))) STORED,
            severity TEXT NOT NULL DEFAULT 'other',
            rule_broken TEXT,
            proof_description TEXT,
            proof_url TEXT,
            time_of_offense TEXT,
            lobby_name TEXT,
            thread_id TEXT,
            thread_url TEXT,
            status TEXT NOT NULL DEFAULT 'open',
            actioned_by TEXT,
            actioned_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await executeQuery(
        'CREATE INDEX IF NOT EXISTS idx_player_reports_status_created ON player_reports (status, created_at)'
    ).catch(() => {});
    await executeQuery(
        'CREATE INDEX IF NOT EXISTS idx_player_reports_reported_key ON player_reports (reported_key)'
    ).catch(() => {});
    await executeQuery(
        'CREATE INDEX IF NOT EXISTS idx_player_reports_reporter ON player_reports (reporter_id)'
    ).catch(() => {});
};

// ON CONFLICT DO NOTHING makes this safe for the backfill to re-run. Returns null
// when the report already existed.
const insertPlayerReport = async (report) => {
    const result = await executeQuery(
        `INSERT INTO player_reports
            (ref_id, reporter_id, reporter_tag, reported_name, severity, rule_broken,
             proof_description, proof_url, time_of_offense, lobby_name,
             thread_id, thread_url, status, actioned_by, actioned_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                 COALESCE($13, 'open'), $14, $15, COALESCE($16, NOW()))
         ON CONFLICT (ref_id) DO NOTHING
         RETURNING *`,
        [
            report.refId,
            report.reporterId || null,
            report.reporterTag || null,
            report.reportedName,
            report.severity || 'other',
            report.ruleBroken || null,
            report.proofDescription || null,
            report.proofUrl || null,
            report.timeOfOffense || null,
            report.lobbyName || null,
            report.threadId || null,
            report.threadUrl || null,
            report.status || null,
            report.actionedBy || null,
            report.actionedAt || null,
            report.createdAt || null,
        ]
    );
    return result.rows[0] || null;
};

const setReportThread = async (refId, threadId, threadUrl) => {
    await executeQuery(
        'UPDATE player_reports SET thread_id = $2, thread_url = $3 WHERE ref_id = $1',
        [refId, threadId, threadUrl]
    );
};

// Atomic claim, same shape as assignOfficialRequest: only an unresolved report
// can be actioned. Two moderators racing from their own queues both run this and
// the loser gets no row back, so the reporter is never DMed twice and a decision
// cannot be silently overwritten by a stale button.
// Returns null both when the claim was lost and when the report is not indexed;
// the caller separates those with fetchReportByRefId.
const setReportStatus = async (refId, status, actionedBy) => {
    const result = await executeQuery(
        `WITH prev AS (SELECT ref_id, status FROM player_reports WHERE ref_id = $1)
         UPDATE player_reports r
            SET status = $2, actioned_by = $3, actioned_at = NOW()
           FROM prev
          WHERE r.ref_id = prev.ref_id
            AND prev.status IN ('open', 'needs_info')
         RETURNING r.*, prev.status AS previous_status`,
        [refId, status, actionedBy]
    );
    return result.rows[0] || null;
};

const fetchReportByRefId = async (refId) => {
    const result = await executeQuery('SELECT * FROM player_reports WHERE ref_id = $1', [refId]);
    return result.rows[0] || null;
};

// The queue's one query: every report awaiting action, already carrying the two
// counts the priority score needs. Correlated subqueries are fine at this size and
// keep the scoring inputs next to the row they belong to.
// ponytail: loads the whole open backlog; add a LIMIT if it ever reaches thousands.
const fetchQueueReports = async (statuses = ['open']) => {
    const result = await executeQuery(
        `SELECT r.*,
                (SELECT COUNT(*)::int FROM player_reports o
                  WHERE o.reported_key = r.reported_key
                    AND o.status = 'open'
                    AND o.ref_id <> r.ref_id) AS other_open_count,
                (SELECT COUNT(*)::int FROM player_reports a
                  WHERE a.reporter_id = r.reporter_id AND a.status = 'approved') AS reporter_approved,
                (SELECT COUNT(*)::int FROM player_reports d
                  WHERE d.reporter_id = r.reporter_id AND d.status = 'denied') AS reporter_denied
           FROM player_reports r
          WHERE r.status = ANY($1::text[])
          ORDER BY r.created_at ASC`,
        [statuses]
    );
    return result.rows;
};

// Exact key match first so the player actually named leads, then partial matches
// for the common case of a moderator typing a remembered fragment of a name.
const fetchReportsForPlayer = async (name, limit = 50) => {
    const raw = (name || '').trim();
    const result = await executeQuery(
        `SELECT * FROM player_reports
          WHERE reported_key = lower(btrim($1)) OR reported_name ILIKE '%' || $1 || '%'
          ORDER BY (reported_key = lower(btrim($1))) DESC, created_at DESC
          LIMIT $2`,
        [raw, limit]
    );
    return result.rows;
};

const fetchReportStats = async () => {
    const byStatus = await executeQuery(
        'SELECT status, COUNT(*)::int AS n FROM player_reports GROUP BY status'
    );
    const openBySeverity = await executeQuery(
        `SELECT severity, COUNT(*)::int AS n
           FROM player_reports WHERE status = 'open'
          GROUP BY severity ORDER BY n DESC`
    );
    const oldestOpen = await executeQuery(
        `SELECT ref_id, reported_name, created_at
           FROM player_reports WHERE status = 'open'
          ORDER BY created_at ASC LIMIT 1`
    );
    // Grouped by the generated key alone: including reported_name would split
    // "Player" from "player" and hide exactly the repeat offenders this is for.
    const topReported = await executeQuery(
        `SELECT MIN(reported_name) AS reported_name,
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status = 'open')::int AS open_count
           FROM player_reports
          GROUP BY reported_key
         HAVING COUNT(*) > 1
          ORDER BY open_count DESC, total DESC
          LIMIT 5`
    );
    return {
        byStatus: Object.fromEntries(byStatus.rows.map((r) => [r.status, r.n])),
        openBySeverity: openBySeverity.rows,
        oldestOpen: oldestOpen.rows[0] || null,
        topReported: topReported.rows,
    };
};

module.exports = {
    ensurePlayerReportsSchema,
    insertPlayerReport,
    setReportThread,
    setReportStatus,
    fetchReportByRefId,
    fetchQueueReports,
    fetchReportsForPlayer,
    fetchReportStats,
};
