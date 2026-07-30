'use strict';

// Appends one row per finished host session to the Session Stats tab.

const { getSheetsClient } = require('./sheets_cache');
const { SPREADSHEET_HOST_SESSIONS, HOST_SESSION_SHEET_TAB } = require('../config/constants');
const { SHEET_HEADER, buildSessionRow } = require('./host_session_stats');
const logger = require('./logger');

// Quoted because the tab name contains a space. The API tolerates it unquoted
// today, but quoting is the documented form and costs nothing.
const HEADER_RANGE = `'${HOST_SESSION_SHEET_TAB}'!A1:O1`;
const APPEND_RANGE = `'${HOST_SESSION_SHEET_TAB}'!A:O`;

// The tab starts empty, so the first write lays down the header. Checked rather
// than assumed: a sheet someone cleared by hand should get its header back.
const ensureHeaderRow = async (sheets) => {
    const existing = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_HOST_SESSIONS,
        range: HEADER_RANGE,
    });
    if (existing.data.values?.[0]?.length) return;
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
