'use strict';

// Shared access to the FF tournament stats workbook.
//
// Season tabs (and their weekly S<N>W<n> siblings) are created empty ahead of a
// season starting, so "highest numbered tab" is not the same as "season in
// play". Every FF surface wants the newest season tab that actually holds rows,
// otherwise a pre-created tab blanks out stats, the leaderboard and rank sync
// for the weeks between the tab being made and the season opening.

const FF_SHEET_ID = '1yxGmKTN27i9XtOefErIXKgcbfi1EXJHYWH7wZn_Cnok';

const SEASON_TAB_RE = /^Season (\d+)$/;

// Newest first, sorted numerically: a string sort ranks "Season 9" above
// "Season 45".
const listSeasonTabs = (metadata) =>
    (metadata?.data?.sheets || [])
        .map((sheet) => {
            const title = sheet.properties.title;
            const match = SEASON_TAB_RE.exec(title);
            return match ? { title, number: Number(match[1]) } : null;
        })
        .filter(Boolean)
        .sort((a, b) => b.number - a.number);

// Returns { title, number } for the newest season tab with at least one data
// row, or null when the workbook has no season tabs at all. If every season tab
// is empty the newest is returned so callers keep their own empty-state copy.
async function resolveActiveSeason(sheets, metadata) {
    const seasons = listSeasonTabs(metadata);
    if (seasons.length === 0) {
        return null;
    }
    // One cell per season tab: A2 is the first data row, so it is empty for a
    // tab that only has its header. Every tab is probed rather than the newest
    // few, since a whole season can be laid out in advance.
    const response = await sheets.spreadsheets.values.batchGet({
        spreadsheetId: FF_SHEET_ID,
        ranges: seasons.map((season) => `'${season.title}'!A2`),
    });
    const valueRanges = response.data.valueRanges || [];
    const populated = seasons.find((_, i) => (valueRanges[i]?.values?.[0]?.[0] || '').trim() !== '');
    return populated || seasons[0];
}

module.exports = { FF_SHEET_ID, listSeasonTabs, resolveActiveSeason };
