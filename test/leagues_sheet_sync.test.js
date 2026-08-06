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
    fetchAllLeaguesForCheckin: async () => state.leagues,
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
        ['Disbanded_Leagues']
    );

    const updates = state.calls.filter(([name]) => name === 'update');
    assert.strictEqual(updates.length, 2);
    for (const [, req] of updates) {
        const values = req.requestBody.values;
        assert.deepStrictEqual(values[0], SHEET_COLUMNS);
        assert.strictEqual(values.length, 2);
        assert.strictEqual(req.valueInputOption, 'USER_ENTERED');
        // owner_id lands in column B with the text-guard apostrophe.
        assert.strictEqual(values[1][1], '\'1123467724555812996');
    }

    const clears = state.calls.filter(([name]) => name === 'clear');
    assert.strictEqual(clears.length, 2);
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
