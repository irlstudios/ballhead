'use strict';

// Draws the EMH booking calendar into the configured tab. The database is the
// source of truth; this only mirrors it, so a Sheets failure is logged and the
// next call (the 15-minute job at the latest) redraws everything.

const { getSheetsClient } = require('./sheets_cache');
const { SPREADSHEET_HOST_SESSIONS, EMH_SCHEDULE_TAB } = require('../config/constants');
const { monthGrid, buildMonthRows, GRID_ROWS, GRID_COLUMNS } = require('./emh_calendar');
const { listBookingsBetween } = require('./emh_schedule_queries');
const logger = require('./logger');

const DAY_COLUMN_PIXELS = 170;

// Last payload written, so the 15-minute job costs no Sheets writes on a quiet
// day. ponytail: in-memory, so each restart rewrites once.
let lastWritten = null;
// Every render waits for the previous one, so a render that read the database
// earlier can never finish later and overwrite newer data.
let queue = Promise.resolve();

const createTab = async (sheets) => {
    const created = await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_HOST_SESSIONS,
        requestBody: { requests: [{ addSheet: { properties: { title: EMH_SCHEDULE_TAB, gridProperties: { frozenRowCount: 2 } } } }] },
    });
    const sheetId = created.data.replies[0].addSheet.properties.sheetId;
    await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_HOST_SESSIONS,
        requestBody: {
            requests: [
                { mergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: GRID_COLUMNS }, mergeType: 'MERGE_ALL' } },
                { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: GRID_COLUMNS }, properties: { pixelSize: DAY_COLUMN_PIXELS }, fields: 'pixelSize' } },
            ],
        },
    });
    return sheetId;
};

const resolveSheetId = async (sheets) => {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_HOST_SESSIONS, fields: 'sheets.properties(sheetId,title)' });
    const tab = meta.data.sheets.find((sheet) => sheet.properties.title === EMH_SCHEDULE_TAB);
    return tab ? tab.properties.sheetId : createTab(sheets);
};

const render = async (now) => {
    try {
        const grid = monthGrid(now);
        const bookings = await listBookingsBetween(grid.startInstant, grid.endInstant);
        const rows = buildMonthRows(grid, bookings);
        const signature = JSON.stringify(rows);
        if (signature === lastWritten) return false;
        const sheets = await getSheetsClient();
        const sheetId = await resolveSheetId(sheets);
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_HOST_SESSIONS,
            requestBody: {
                requests: [{
                    updateCells: {
                        range: { sheetId, startRowIndex: 0, endRowIndex: GRID_ROWS, startColumnIndex: 0, endColumnIndex: GRID_COLUMNS },
                        rows,
                        fields: 'userEnteredValue,textFormatRuns,userEnteredFormat',
                    },
                }],
            },
        });
        lastWritten = signature;
        return true;
    } catch (error) {
        logger.error(`[EMH Schedule] Failed to render ${EMH_SCHEDULE_TAB}; the next run will retry.`, error);
        return false;
    }
};

const renderMonthlyView = (now = new Date()) => {
    const next = queue.then(() => render(now));
    queue = next;
    return next;
};

const resetRenderState = () => {
    lastWritten = null;
    queue = Promise.resolve();
};

module.exports = { renderMonthlyView, resetRenderState };
