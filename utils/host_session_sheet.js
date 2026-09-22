'use strict';

// Appends one row per finished host session to the Session Stats tab.

const { getSheetsClient } = require('./sheets_cache');
const { SPREADSHEET_HOST_SESSIONS, HOST_SESSION_SHEET_TAB } = require('../config/constants');
const { SHEET_HEADER, buildSessionRow } = require('./host_session_stats');
const logger = require('./logger');

// Derived from the header rather than hardcoded, so adding a column cannot leave
// the range one short and silently drop it on every write.
const columnName = (n) => (n > 26 ? columnName(Math.floor((n - 1) / 26)) : '') + String.fromCharCode(65 + ((n - 1) % 26));
const LAST_COLUMN = columnName(SHEET_HEADER.length);
// Quoted because the tab name contains a space. The API tolerates it unquoted
// today, but quoting is the documented form and costs nothing.
const HEADER_RANGE = `'${HOST_SESSION_SHEET_TAB}'!A1:${LAST_COLUMN}1`;
const APPEND_RANGE = `'${HOST_SESSION_SHEET_TAB}'!A:${LAST_COLUMN}`;

// The tab starts empty, so the first write lays down the header. Compared by
// width rather than mere presence, so a sheet someone cleared by hand gets its
// header back and one written before a column was added is widened in place.
const ensureHeaderRow = async (sheets) => {
    const existing = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_HOST_SESSIONS,
        range: HEADER_RANGE,
    });
    if (existing.data.values?.[0]?.length === SHEET_HEADER.length) return;
    await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_HOST_SESSIONS,
        range: HEADER_RANGE,
        valueInputOption: 'RAW',
        requestBody: { values: [SHEET_HEADER] },
    });
};

// Never throws: a Sheets outage must not stop the room from being handed back to
// its host. The row is logged in full so it can be replayed by hand if needed.
const appendSessionRow = async ({ session, summary }) => {
    const row = buildSessionRow({ session, summary });
    try {
        const sheets = await getSheetsClient();
        await ensureHeaderRow(sheets);
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_HOST_SESSIONS,
            range: APPEND_RANGE,
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            requestBody: { values: [row] },
        });
        logger.info(`[Host Session] Wrote stats for session ${session.id} to ${HOST_SESSION_SHEET_TAB}.`);
        return true;
    } catch (error) {
        logger.error(`[Host Session] Failed to write session ${session.id} to the sheet. Row: ${JSON.stringify(row)}`, error);
        return false;
    }
};

module.exports = { appendSessionRow, ensureHeaderRow };
