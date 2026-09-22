'use strict';

// Database access for the Top Event Winner race: the standings for a cycle, and
// the record of which cycles have already been announced.
//
// Cycles are recorded rather than merely counted so the announcement is
// idempotent. The daily job recomputes the same closed cycle every day until it
// claims it, which is what lets a run missed during downtime land a day late
// instead of never.

const { executeQuery } = require('../db');
const { dayStartInstant } = require('./event_winner_cycle');

const ensureEventWinnerSchema = async () => {
    await executeQuery(`
        CREATE TABLE IF NOT EXISTS event_winner_cycles (
            cycle_start DATE PRIMARY KEY,
            cycle_end DATE NOT NULL,
            winner_id TEXT NOT NULL,
            winner_name TEXT,
            wins INTEGER NOT NULL,
            announced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
};

// Wins per member inside the window, end exclusive. Ties break toward whoever
// reached the count first, so the standings are deterministic and the earlier
// winner is not displaced by someone who caught up on the last day.
const listCycleStandings = async ({ start, end }) => {
    const result = await executeQuery(
        `SELECT winner_id, MAX(winner_name) AS winner_name, COUNT(*)::INTEGER AS wins, MAX(ended_at) AS last_win
           FROM host_sessions
          WHERE winner_id IS NOT NULL
            AND ended_at >= $1::timestamptz
            AND ended_at < $2::timestamptz
          GROUP BY winner_id
          ORDER BY wins DESC, last_win ASC`,
        // Absolute instants, so the window cannot shift with whatever timezone
        // the database session happens to be using.
        [dayStartInstant(start), dayStartInstant(end)]
    );
    return result.rows.map((row) => ({
        userId: row.winner_id,
        userName: row.winner_name,
        wins: Number(row.wins) || 0,
    }));
};

// Returns null when this cycle was already announced, which is how a rerun on
// any later day of the same cycle turns into a no-op.
const claimCycle = async ({ start, end, winnerId, winnerName, wins }) => {
    const result = await executeQuery(
        `INSERT INTO event_winner_cycles (cycle_start, cycle_end, winner_id, winner_name, wins)
         VALUES ($1::date, $2::date, $3, $4, $5)
         ON CONFLICT (cycle_start) DO NOTHING
         RETURNING cycle_start`,
        [start, end, winnerId, winnerName || null, wins]
    );
    return result.rows[0] ? { cycleStart: result.rows[0].cycle_start } : null;
};

// The member who held the role going into this cycle, so it can be taken back.
const getPreviousCycleWinnerId = async (start) => {
    const result = await executeQuery(
        'SELECT winner_id FROM event_winner_cycles WHERE cycle_start < $1::date ORDER BY cycle_start DESC LIMIT 1',
        [start]
    );
    return result.rows[0]?.winner_id || null;
};

module.exports = {
    ensureEventWinnerSchema,
    listCycleStandings,
    claimCycle,
    getPreviousCycleWinnerId,
};
