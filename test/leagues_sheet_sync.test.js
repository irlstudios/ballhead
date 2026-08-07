'use strict';

const test = require('node:test');
const assert = require('node:assert');

// Mocks db.js, utils/sheets_cache.js and utils/logger.js by swapping the
// module cache entry before jobs/leagues-sheet-sync is first required
// (mirrors test/tourny_sync_job.test.js).

function installMock(relativePath, mockExports) {
    const modulePath = require.resolve(relativePath);
    require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports: mockExports };
}

const state = {
    leagues: [],
    existingTabs: [],
    calls: [],
};

installMock('../db.js', {
    fetchLeaguesForSheetSync: async () => state.leagues,
});

installMock('../utils/logger.js', {
    info: () => {},
    warn: () => {},
    error: () => {},
});

installMock('../utils/sheets_cache.js', {
    getSheetsClient: async () => ({
        spreadsheets: {
            get: async () => ({
                data: {
                    sheets: state.existingTabs.map((t) => ({
                        properties: {
                            title: t.title,
                            gridProperties: { rowCount: t.rowCount, columnCount: 30 },
                        },
                    })),
                },
            }),
            batchUpdate: async (req) => { state.calls.push(['batchUpdate', req]); },
            values: {
                clear: async (req) => { state.calls.push(['clear', req]); },
                update: async (req) => { state.calls.push(['update', req]); },
            },
        },
    }),
});

const {
    runLeaguesSheetSync,
    toCell,
    groupByStatus,
    withMetrics,
    buildMetricsRows,
    SHEET_COLUMNS,
} = require('../jobs/leagues-sheet-sync');

function league(overrides = {}) {
    return {
        league_id: 64,
        owner_id: '1123467724555812996',
        owner_discord_name: 'gcnba',
        league_name: 'GC NBA',
        league_status: 'Active',
        member_count: 3043,
        is_sponsored: true,
        approval_date: new Date(2024, 10, 10),
        ...overrides,
    };
}

test('toCell formats each value type for a USER_ENTERED write', () => {
    assert.strictEqual(toCell(null), '');
    assert.strictEqual(toCell(undefined), '');
    assert.strictEqual(toCell(true), 'TRUE');
    assert.strictEqual(toCell(false), 'FALSE');
    assert.strictEqual(toCell(42), 42);
    assert.strictEqual(toCell('CBL'), 'CBL');
    // Discord snowflakes exceed double precision: must stay text.
    assert.strictEqual(toCell('1123467724555812996'), '\'1123467724555812996');
    // Formula-leading strings must not execute.
    assert.strictEqual(toCell('=SUM(A1)'), '\'=SUM(A1)');
    assert.strictEqual(toCell('+1234'), '\'+1234');
    // Dates use local components (pg parses DATE columns in host-local time).
    assert.strictEqual(toCell(new Date(2024, 10, 10)), '2024-11-10');
});

test('groupByStatus buckets rows into one tab per status', () => {
    const groups = groupByStatus([
        league({ league_id: 1, league_status: 'Active' }),
        league({ league_id: 2, league_status: 'Inactive' }),
        league({ league_id: 3, league_status: 'Active' }),
        league({ league_id: 4, league_status: null }),
    ]);
    assert.deepStrictEqual([...groups.keys()].sort(), ['Active_Leagues', 'Inactive_Leagues', 'Unknown_Leagues']);
    assert.strictEqual(groups.get('Active_Leagues').length, 2);
    assert.strictEqual(groups.get('Unknown_Leagues').length, 1);
});

test('runLeaguesSheetSync creates missing tabs, grows small ones, and rewrites each tab', async () => {
    state.leagues = [
        league({ league_id: 1, league_status: 'Active' }),
        league({ league_id: 2, league_status: 'Disbanded' }),
    ];
    state.existingTabs = [{ title: 'Active_Leagues', rowCount: 178 }];
    state.calls = [];

    await runLeaguesSheetSync();

    const batches = state.calls.filter(([name]) => name === 'batchUpdate');
    assert.strictEqual(batches.length, 1);
    const requests = batches[0][1].requestBody.requests;
    assert.deepStrictEqual(
        requests.map((r) => r.addSheet?.properties?.title).filter(Boolean),
        ['Disbanded_Leagues', 'Metrics']
    );
    // The mocked existing tab has 30 columns; the wider schema must grow it.
    const grow = requests.find((r) => r.updateSheetProperties);
    assert.ok(grow, 'expected column growth for the existing narrow tab');
    assert.ok(grow.updateSheetProperties.properties.gridProperties.columnCount >= SHEET_COLUMNS.length);

    const updates = state.calls.filter(([name]) => name === 'update');
    assert.strictEqual(updates.length, 3);
    const statusUpdates = updates.filter(([, req]) => !req.range.includes('Metrics'));
    assert.strictEqual(statusUpdates.length, 2);
    for (const [, req] of statusUpdates) {
        const values = req.requestBody.values;
        assert.deepStrictEqual(values[0], SHEET_COLUMNS);
        assert.strictEqual(values.length, 2);
        assert.strictEqual(req.valueInputOption, 'USER_ENTERED');
        // owner_id lands in column B with the text-guard apostrophe.
        assert.strictEqual(values[1][1], '\'1123467724555812996');
    }
    const metricsUpdate = updates.find(([, req]) => req.range.includes('Metrics'));
    assert.ok(metricsUpdate, 'Metrics tab must be written');
    assert.deepStrictEqual(metricsUpdate[1].requestBody.values[0], ['Metric', 'Value']);

    const clears = state.calls.filter(([name]) => name === 'clear');
    assert.strictEqual(clears.length, 3);
});

test('runLeaguesSheetSync grows a tab whose grid is smaller than the row count', async () => {
    state.leagues = Array.from({ length: 250 }, (_, i) =>
        league({ league_id: i + 1, league_status: 'Active' })
    );
    state.existingTabs = [{ title: 'Active_Leagues', rowCount: 178 }];
    state.calls = [];

    await runLeaguesSheetSync();

    const batches = state.calls.filter(([name]) => name === 'batchUpdate');
    assert.strictEqual(batches.length, 1);
    const grow = batches[0][1].requestBody.requests.find((r) => r.updateSheetProperties);
    assert.ok(grow, 'expected an updateSheetProperties request to grow the grid');
    assert.ok(grow.updateSheetProperties.properties.gridProperties.rowCount >= 251);
});


test('withMetrics derives standing and check-in counts per league', () => {
    const now = new Date('2026-08-01T00:00:00Z');
    const qualifying = withMetrics(league({
        league_type: 'Base',
        member_count: 120,
        approval_date: '2026-06-01',
        last_checkin_date: '2026-07-20',
        last_health_check: '2026-07-28',
        checkin_months: ['2026-06', '2026-07'],
        active_strikes: 0,
        health_status: 'Healthy',
    }), now);
    assert.strictEqual(qualifying.checkin_months_count, 2);
    assert.strictEqual(qualifying.meets_active_requirements, true);
    assert.strictEqual(qualifying.failed_requirements, '');

    const failing = withMetrics(league({
        league_type: 'Base',
        member_count: 5,
        approval_date: '2026-06-01',
        last_checkin_date: '2026-07-20',
        last_health_check: '2026-07-28',
        checkin_months: ['2026-07'],
        active_strikes: 0,
        health_status: 'Healthy',
    }), now);
    assert.strictEqual(failing.meets_active_requirements, false);
    assert.ok(failing.failed_requirements.length > 0);

    const disbanded = withMetrics(league({ league_status: 'Disbanded', checkin_months: [] }), now);
    assert.strictEqual(disbanded.meets_active_requirements, '');
});

test('buildMetricsRows summarizes the program', () => {
    const now = new Date('2026-08-01T00:00:00Z');
    const rows = buildMetricsRows([
        withMetrics(league({ league_id: 1, league_status: 'Active', league_type: 'Base', active_strikes: 1, games_total: 3, games_30d: 2, checkin_months: [] }), now),
        withMetrics(league({ league_id: 2, league_status: 'Disbanded', checkin_months: [] }), now),
    ], now);
    const asMap = new Map(rows.slice(1).map(([k, v]) => [k, v]));
    assert.strictEqual(asMap.get('Total leagues'), 2);
    assert.strictEqual(asMap.get('Status: Active'), 1);
    assert.strictEqual(asMap.get('Status: Disbanded'), 1);
    assert.strictEqual(asMap.get('Active strikes (all leagues)'), 1);
    assert.strictEqual(asMap.get('Games recorded (all time)'), 3);
    assert.strictEqual(asMap.get('Games recorded (last 30 days)'), 2);
});
