'use strict';

// Metadata for captured voice incidents. The audio itself lives as the
// attachment on the evidence message; this table is the queryable index.
// Kept out of db.js per the utils/host_session_queries.js precedent.

const { executeQuery } = require('../../db');

const ensureVoiceIncidentsSchema = async () => {
    await executeQuery(`
        CREATE TABLE IF NOT EXISTS voice_incidents (
            id BIGSERIAL PRIMARY KEY,
            session_id BIGINT REFERENCES host_sessions(id) ON DELETE SET NULL,
            channel_id TEXT NOT NULL,
            clipped_by TEXT NOT NULL,
            note TEXT,
            window_start TIMESTAMPTZ NOT NULL,
            window_end TIMESTAMPTZ NOT NULL,
            participants JSONB NOT NULL DEFAULT '[]',
            evidence_message_url TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
};

const insertIncident = async ({
    sessionId, channelId, clippedBy, note, windowStart, windowEnd, participantIds, evidenceMessageUrl,
}) => {
    const result = await executeQuery(
        `INSERT INTO voice_incidents
            (session_id, channel_id, clipped_by, note, window_start, window_end, participants, evidence_message_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
         RETURNING id`,
        [sessionId, channelId, clippedBy, note || null, windowStart, windowEnd,
            JSON.stringify(participantIds || []), evidenceMessageUrl || null]
    );
    return result.rows[0].id;
};

module.exports = { ensureVoiceIncidentsSchema, insertIncident };
