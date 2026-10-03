'use strict';

// Database access for EMH self-scheduling. The exclusion constraint is what
// makes double-booking impossible, including two hosts clicking in the same
// second; the pre-check in createBooking only exists to answer the common case
// without tripping the constraint and logging an error.

const { executeQuery } = require('../db');

const OVERLAP_ERROR = '23P01';

// The table name is a parameter only so the constraint test can build the same
// table in a throwaway schema. It is never user input.
const bookingsTableSql = (table = 'emh_bookings') => `
    CREATE TABLE IF NOT EXISTS ${table} (
        id BIGSERIAL PRIMARY KEY,
        host_id TEXT NOT NULL,
        host_username TEXT NOT NULL,
        starts_at TIMESTAMPTZ NOT NULL,
        ends_at TIMESTAMPTZ NOT NULL,
        status TEXT NOT NULL DEFAULT 'scheduled'
            CHECK (status IN ('scheduled', 'hosted', 'no_show', 'cancelled')),
        status_source TEXT NOT NULL DEFAULT 'auto'
            CHECK (status_source IN ('auto', 'manual')),
        created_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        cancelled_by TEXT,
        cancelled_at TIMESTAMPTZ,
        CHECK (ends_at > starts_at),
        EXCLUDE USING gist (tstzrange(starts_at, ends_at, '[)') WITH &&)
            WHERE (status <> 'cancelled')
    )
`;

const ensureEmhScheduleSchema = async () => {
    await executeQuery(bookingsTableSql());
    await executeQuery('CREATE INDEX IF NOT EXISTS idx_emh_bookings_host_start ON emh_bookings (host_id, starts_at)');
};

const mapBooking = (row) => (row ? {
    id: Number(row.id),
    hostId: row.host_id,
    hostUsername: row.host_username,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    statusSource: row.status_source,
} : null);

const findConflict = async ({ startsAt, endsAt, excludeId = null }) => {
    const result = await executeQuery(
        `SELECT * FROM emh_bookings
          WHERE status <> 'cancelled'
            AND tstzrange(starts_at, ends_at, '[)') && tstzrange($1::timestamptz, $2::timestamptz, '[)')
            AND ($3::bigint IS NULL OR id <> $3::bigint)
          ORDER BY starts_at
          LIMIT 1`,
        [startsAt, endsAt, excludeId]
    );
    return mapBooking(result.rows[0]);
};

const createBooking = async ({ hostId, hostUsername, startsAt, endsAt, createdBy, status = 'scheduled', statusSource = 'auto' }) => {
    const existing = await findConflict({ startsAt, endsAt });
    if (existing) return { conflict: existing };
    try {
        const result = await executeQuery(
            `INSERT INTO emh_bookings (host_id, host_username, starts_at, ends_at, status, status_source, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [hostId, hostUsername, startsAt, endsAt, status, statusSource, createdBy]
        );
        return { booking: mapBooking(result.rows[0]) };
    } catch (error) {
        if (error.code !== OVERLAP_ERROR) throw error;
        return { conflict: await findConflict({ startsAt, endsAt }) };
    }
};

const rescheduleBooking = async ({ id, startsAt, endsAt }) => {
    const existing = await findConflict({ startsAt, endsAt, excludeId: id });
    if (existing) return { conflict: existing };
    try {
        const result = await executeQuery(
            `UPDATE emh_bookings SET starts_at = $2, ends_at = $3
              WHERE id = $1 AND status = 'scheduled'
              RETURNING *`,
            [id, startsAt, endsAt]
        );
        return result.rows[0] ? { booking: mapBooking(result.rows[0]) } : { missing: true };
    } catch (error) {
        if (error.code !== OVERLAP_ERROR) throw error;
        return { conflict: await findConflict({ startsAt, endsAt, excludeId: id }) };
    }
};

const cancelBooking = async ({ id, cancelledBy }) => {
    const result = await executeQuery(
        `UPDATE emh_bookings SET status = 'cancelled', cancelled_by = $2, cancelled_at = NOW()
          WHERE id = $1 AND status = 'scheduled'
          RETURNING *`,
        [id, cancelledBy]
    );
    return mapBooking(result.rows[0]);
};

const getBooking = async (id) => {
    const result = await executeQuery('SELECT * FROM emh_bookings WHERE id = $1', [id]);
    return mapBooking(result.rows[0]);
};

const listUpcomingBookings = async ({ hostId = null } = {}) => {
    const result = await executeQuery(
        `SELECT * FROM emh_bookings
          WHERE status = 'scheduled' AND starts_at > NOW() AND ($1::text IS NULL OR host_id = $1)
          ORDER BY starts_at
          LIMIT 25`,
        [hostId]
    );
    return result.rows.map(mapBooking);
};

const listBookingsBetween = async (from, to) => {
    const result = await executeQuery(
        'SELECT * FROM emh_bookings WHERE starts_at >= $1 AND starts_at < $2 ORDER BY starts_at',
        [from, to]
    );
    return result.rows.map(mapBooking);
};

const listDueBookings = async (now) => {
    const result = await executeQuery(
        `SELECT * FROM emh_bookings
          WHERE status = 'scheduled' AND status_source = 'auto' AND ends_at <= $1
          ORDER BY starts_at`,
        [now]
    );
    return result.rows.map(mapBooking);
};

const listSessionsForHosts = async (hostIds, from, to) => {
    const result = await executeQuery(
        `SELECT host_id, started_at, ended_at FROM host_sessions
          WHERE host_id = ANY($1::text[]) AND started_at < $3 AND COALESCE(ended_at, NOW()) > $2`,
        [hostIds, from, to]
    );
    return result.rows.map((row) => ({ hostId: row.host_id, startedAt: row.started_at, endedAt: row.ended_at }));
};

// Guarded on scheduled + auto so a slot cancelled or hand-set in the meantime
// keeps its status.
const setBookingStatus = async (id, status) => {
    await executeQuery(
        `UPDATE emh_bookings SET status = $2
          WHERE id = $1 AND status = 'scheduled' AND status_source = 'auto'`,
        [id, status]
    );
};

const bookingExists = async ({ hostId, startsAt }) => {
    const result = await executeQuery(
        'SELECT 1 FROM emh_bookings WHERE host_id = $1 AND starts_at = $2 LIMIT 1',
        [hostId, startsAt]
    );
    return result.rows.length > 0;
};

module.exports = {
    OVERLAP_ERROR,
    bookingsTableSql,
    ensureEmhScheduleSchema,
    findConflict,
    createBooking,
    rescheduleBooking,
    cancelBooking,
    getBooking,
    listUpcomingBookings,
    listBookingsBetween,
    listDueBookings,
    listSessionsForHosts,
    setBookingStatus,
    bookingExists,
};
