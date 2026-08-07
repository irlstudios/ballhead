'use strict';

const { getSheetsClient } = require('../utils/sheets_cache');
const { fetchLeaguesForSheetSync } = require('../db');
const { tierStanding } = require('../utils/league_tier_sync');
const { SPREADSHEET_LEAGUES } = require('../config/constants');
const logger = require('../utils/logger');

// Every column on the "Active Leagues" table, in ordinal order.
const DB_COLUMNS = [
    'league_id', 'owner_id', 'owner_discord_name', 'league_name', 'server_name',
    'server_id', 'member_count', 'server_owner_id', 'league_type', 'league_status',
    'approval_date', 'is_sponsored', 'league_invite', 'server_icon', 'server_banner',
    'vanity_url', 'server_description', 'server_features', 'league_star_rating',
    'league_star_rating_count', 'event_calendar', 'league_features', 'tags',
    'owner_comment', 'is_featured', 'owner_profile_picture', 'league_coowner',
    'last_health_check', 'last_checkin_date', 'co_owner_1', 'co_owner_2',
    'sport', 'league_hashtag', 'content_tracking_enabled', 'health_status', 'reward_poc_id',
];

// Derived metrics appended after the raw columns.
const METRIC_COLUMNS = [
    'active_strikes', 'total_strikes', 'checkin_months_count',
    'games_total', 'games_30d', 'meets_active_requirements', 'failed_requirements',
];

const SHEET_COLUMNS = [...DB_COLUMNS, ...METRIC_COLUMNS];
const METRICS_TAB = 'Metrics';
const GRID_COLUMNS = 60;
const CLEAR_RANGE = 'A1:BH100000';
const DAY_MS = 24 * 60 * 60 * 1000;

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

// Attach the derived metric fields the sheet shows next to the raw columns.
function withMetrics(league, now = new Date()) {
    const standing = tierStanding(league, now);
    return {
        ...league,
        checkin_months_count: (league.checkin_months || []).length,
        meets_active_requirements: standing.meets === null ? '' : standing.meets,
        failed_requirements: standing.meets === false
            ? standing.checks.filter((c) => !c.ok).map((c) => c.label).join('; ')
            : '',
    };
}

function groupByStatus(leagues) {
    const groups = new Map();
    for (const row of leagues) {
        const title = `${row.league_status || 'Unknown'}_Leagues`;
        groups.set(title, [...(groups.get(title) || []), row]);
    }
    return groups;
}

function countBy(rows, keyOf) {
    const counts = new Map();
    for (const row of rows) {
        const key = keyOf(row);
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
}

// Program-level summary for the Metrics tab.
function buildMetricsRows(leagues, now = new Date()) {
    const live = leagues.filter((l) => l.league_status === 'Active');
    const standings = live.map((l) => tierStanding(l, now));
    const memberCounts = live.map((l) => l.member_count).filter(Number.isFinite).sort((a, b) => a - b);
    const sum = (key) => leagues.reduce((n, l) => n + (l[key] || 0), 0);

    return [
        ['Metric', 'Value'],
        ['Last synced (UTC)', now.toISOString()],
        ['Total leagues', leagues.length],
        ...[...countBy(leagues, (l) => l.league_status || 'Unknown')].map(([k, v]) => [`Status: ${k}`, v]),
        ...[...countBy(live, (l) => l.league_type || 'Unknown')].map(([k, v]) => [`Live tier: ${k}`, v]),
        ['Base leagues meeting Active requirements', standings.filter((s) => s.tier === 'Base' && s.meets).length],
        ['Active leagues below retention bar', standings.filter((s) => s.tier === 'Active' && s.meets === false).length],
        ['Live leagues checked in (last 35 days)', live.filter((l) => l.last_checkin_date && now.getTime() - new Date(l.last_checkin_date).getTime() <= 35 * DAY_MS).length],
        ['Live leagues never checked in', live.filter((l) => !l.last_checkin_date).length],
        ['Active strikes (all leagues)', sum('active_strikes')],
        ['Median member count (live leagues)', memberCounts.length > 0 ? memberCounts[Math.floor(memberCounts.length / 2)] : ''],
        ['Games recorded (all time)', sum('games_total')],
        ['Games recorded (last 30 days)', sum('games_30d')],
    ];
}

// Mirrors the whole "Active Leagues" table into the leagues spreadsheet:
// one tab per league_status with every DB column plus derived metrics, and a
// Metrics tab with program-level numbers. Full rewrite each run. Creates tabs
// that are missing and grows any tab whose grid is too small.
async function runLeaguesSheetSync() {
    const now = new Date();
    const leagues = (await fetchLeaguesForSheetSync()).map((l) => withMetrics(l, now));
    const groups = groupByStatus(leagues);
    const sheets = await getSheetsClient();

    const tabPlans = [
        ...[...groups.entries()].map(([title, rows]) => ({
            title,
            neededRows: rows.length + 1,
            values: [SHEET_COLUMNS, ...rows.map((row) => SHEET_COLUMNS.map((k) => toCell(row[k])))],
        })),
        {
            title: METRICS_TAB,
            neededRows: 50,
            values: buildMetricsRows(leagues, now).map((row) => row.map(toCell)),
        },
    ];

    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_LEAGUES });
    const existing = new Map(meta.data.sheets.map((s) => [
        s.properties.title,
        {
            sheetId: s.properties.sheetId,
            rowCount: s.properties.gridProperties.rowCount,
            columnCount: s.properties.gridProperties.columnCount,
        },
    ]));

    const requests = tabPlans.flatMap(({ title, neededRows }) => {
        const tab = existing.get(title);
        if (!tab) {
            return [{
                addSheet: {
                    properties: {
                        title,
                        gridProperties: { rowCount: Math.max(neededRows, 1000), columnCount: GRID_COLUMNS },
                    },
                },
            }];
        }
        if (tab.rowCount < neededRows || tab.columnCount < SHEET_COLUMNS.length) {
            return [{
                updateSheetProperties: {
                    properties: {
                        sheetId: tab.sheetId,
                        gridProperties: {
                            rowCount: Math.max(tab.rowCount, neededRows),
                            columnCount: Math.max(tab.columnCount, GRID_COLUMNS),
                        },
                    },
                    fields: 'gridProperties.rowCount,gridProperties.columnCount',
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

    for (const { title, values } of tabPlans) {
        await sheets.spreadsheets.values.clear({
            spreadsheetId: SPREADSHEET_LEAGUES,
            range: `'${title}'!${CLEAR_RANGE}`,
        });
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_LEAGUES,
            range: `'${title}'!A1`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values },
        });
    }

    logger.info(`[Leagues Sheet Sync] Synced ${leagues.length} leagues across ${groups.size} tabs plus ${METRICS_TAB}`);
}

module.exports = {
    runLeaguesSheetSync,
    toCell,
    groupByStatus,
    withMetrics,
    buildMetricsRows,
    SHEET_COLUMNS,
};
