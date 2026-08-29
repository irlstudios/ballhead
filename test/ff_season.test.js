'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { listSeasonTabs, resolveActiveSeason } = require('../utils/ff_sheet');

const metadataFor = (titles) => ({
    data: { sheets: titles.map((title) => ({ properties: { title } })) },
});

// Fake Sheets client: batchGet answers with rows for the tabs named in
// populated, and an empty valueRange for everything else.
const sheetsFor = (populated) => ({
    spreadsheets: {
        values: {
            batchGet: async ({ ranges }) => ({
                data: {
                    valueRanges: ranges.map((range) => {
                        const title = range.slice(1, range.indexOf('\'!'));
                        return populated.includes(title) ? { values: [['PLAYER']] } : {};
                    }),
                },
            }),
        },
    },
});

test('skips a season tab that exists but has no rows yet', async () => {
    const metadata = metadataFor(['Season 43', 'Season 44', 'Season 45', 'S45W1']);
    const season = await resolveActiveSeason(sheetsFor(['Season 44', 'Season 43']), metadata);
    assert.strictEqual(season.title, 'Season 44');
    assert.strictEqual(season.number, 44);
});

test('uses the newest season once it has rows', async () => {
    const metadata = metadataFor(['Season 44', 'Season 45']);
    const season = await resolveActiveSeason(sheetsFor(['Season 45', 'Season 44']), metadata);
    assert.strictEqual(season.title, 'Season 45');
});

test('orders season tabs numerically, not as strings', () => {
    const titles = listSeasonTabs(metadataFor(['Season 9', 'Season 45', 'Season 44'])).map((s) => s.title);
    assert.deepStrictEqual(titles, ['Season 45', 'Season 44', 'Season 9']);
});

test('ignores weekly and non-season tabs', () => {
    const titles = listSeasonTabs(metadataFor(['S45W1', 'Season 16 Final', 'Discord IDs', 'Season 44'])).map((s) => s.title);
    assert.deepStrictEqual(titles, ['Season 44']);
});

test('looks past several empty tabs laid out in advance', async () => {
    const metadata = metadataFor(['Season 42', 'Season 43', 'Season 44', 'Season 45']);
    const season = await resolveActiveSeason(sheetsFor(['Season 42']), metadata);
    assert.strictEqual(season.title, 'Season 42');
});

test('falls back to the newest tab when every season tab is empty', async () => {
    const metadata = metadataFor(['Season 44', 'Season 45']);
    const season = await resolveActiveSeason(sheetsFor([]), metadata);
    assert.strictEqual(season.title, 'Season 45');
});

test('returns null when the workbook has no season tabs', async () => {
    const season = await resolveActiveSeason(sheetsFor([]), metadataFor(['Discord IDs']));
    assert.strictEqual(season, null);
});
