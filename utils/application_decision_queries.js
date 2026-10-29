'use strict';

// Database access for application decisions. Kept out of db.js, which is
// already well past the project's file-size ceiling; utils/host_session_queries.js
// is the precedent.
//
// One row per decided review card, for every program that grants a role from
// an Accept/Deny card. The unique message_id is the double-click guard: the
// first insert claims the card, any later click on it gets nothing back. The
// rows are also the audit trail, since the per-program application rows are
// deleted on decision so applicants can reapply.

const { executeQuery } = require('../db');

const ensureApplicationDecisionsTable = async () => {
    await executeQuery(`
        CREATE TABLE IF NOT EXISTS application_decisions (
            id SERIAL PRIMARY KEY,
            program TEXT NOT NULL,
            message_id TEXT NOT NULL UNIQUE,
            applicant_id TEXT NOT NULL,
            decision TEXT NOT NULL,
            decided_by TEXT NOT NULL,
            card_text TEXT,
            decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await executeQuery(
        'CREATE INDEX IF NOT EXISTS idx_application_decisions_applicant ON application_decisions (program, applicant_id)'
    );
};

// Returns the new row id, or null when the card was already decided.
const insertApplicationDecision = async ({ program, messageId, applicantId, decision, decidedBy, cardText }) => {
    const result = await executeQuery(
        `INSERT INTO application_decisions (program, message_id, applicant_id, decision, decided_by, card_text)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (message_id) DO NOTHING
         RETURNING id`,
        [program, messageId, applicantId, decision, decidedBy, cardText || null]
    );
    return result.rows[0]?.id ?? null;
};

const deleteApplicationDecision = async (id) => {
    await executeQuery('DELETE FROM application_decisions WHERE id = $1', [id]);
};

module.exports = {
    ensureApplicationDecisionsTable,
    insertApplicationDecision,
    deleteApplicationDecision,
};
