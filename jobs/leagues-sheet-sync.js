'use strict';

const { getSheetsClient } = require('../utils/sheets_cache');
const { fetchAllLeaguesForCheckin } = require('../db');
const { SPREADSHEET_LEAGUES } = require('../config/constants');
const logger = require('../utils/logger');

// Column order matches the sheet's existing headers. The DB table carries
// newer columns (sport, health_status, co_owner_1/2, ...) the sheet does not.
const SHEET_COLUMNS = [
    'league_id', 'owner_id', 'owner_discord_name', 'league_name', 'server_name',
    'server_id', 'member_count', 'server_owner_id', 'league_type', 'league_status',
    'approval_date', 'is_sponsored', 'league_invite', 'server_icon', 'server_banner',
    'vanity_url', 'server_description', 'server_features', 'league_star_rating',
    'league_star_rating_count', 'event_calendar', 'league_features', 'tags',
    'owner_comment', 'is_featured', 'owner_profile_picture', 'league_coowner',
];

function toCell(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    if (typeof value === 'number') return value;
    if (value instanceof Date) {
        // Local components, not toISOString: pg parses DATE columns into
        // host-local midnight, so UTC conversion can shift the day.
        const y = value.getFullYear();
        const m = String(value.getMonth() + 1).padStart(2, '0');
        const d = String(value.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    const s = String(value);
    // USER_ENTERED write: a leading apostrophe keeps Discord snowflakes as
    // text (they exceed double precision) and defuses formula-leading chars.
    if (/^\d{15,}$/.test(s) || /^[=+]/.test(s)) return `'${s}`;
    return s;
}

function groupByStatus(leagues) {
    const groups = new Map();
    for (const row of leagues) {
        const title = `${row.league_status || 'Unknown'}_Leagues`;
        groups.set(title, [...(groups.get(title) || []), row]);
    }
    return groups;
}

// Mirrors the whole "Active Leagues" table into the leagues spreadsheet,
// one tab per league_status, full rewrite each run. Creates tabs for
// statuses that appear and grows any tab whose grid is too small; a status
// that stops appearing leaves its old tab behind untouched.
async function runLeaguesSheetSync() {
    const leagues = await fetchAllLeaguesForCheckin();
    const groups = groupByStatus(leagues);
    const sheets = await getSheetsClient();

    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_LEAGUES });
    const existing = new Map(meta.data.sheets.map((s) => [
        s.properties.title,
        s.properties.gridProperties.rowCount,
    ]));

    const requests = [...groups.entries()].flatMap(([title, rows]) => {
        const needed = rows.length + 1;
        if (!existing.has(title)) {
            return [{
                addSheet: {
                    properties: {
                        title,
                        gridProperties: { rowCount: Math.max(needed, 1000), columnCount: 30 },
                    },
                },
            }];
        }
        if (existing.get(title) < needed) {
            return [{
                updateSheetProperties: {
                    properties: {
                        sheetId: meta.data.sheets.find((s) => s.properties.title === title).properties.sheetId,
                        gridProperties: { rowCount: needed },
                    },
                    fields: 'gridProperties.rowCount',
                },
            }];
        }
        return [];
    });
    if (requests.length > 0) {
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_LEAGUES,
            requestBody: { requests },
        });
    }

    for (const [title, rows] of groups) {
        const values = [SHEET_COLUMNS, ...rows.map((row) => SHEET_COLUMNS.map((k) => toCell(row[k])))];
        await sheets.spreadsheets.values.clear({
            spreadsheetId: SPREADSHEET_LEAGUES,
            range: `'${title}'!A1:AA100000`,
        });
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_LEAGUES,
            range: `'${title}'!A1`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values },
        });
    }

    logger.info(`[Leagues Sheet Sync] Synced ${leagues.length} leagues across ${groups.size} tabs`);
}

module.exports = { runLeaguesSheetSync, toCell, groupByStatus, SHEET_COLUMNS };
