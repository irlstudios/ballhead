'use strict';

const { getSheetsClient } = require('../../../utils/sheets_cache');
const logger = require('../../../utils/logger');
const { config } = require('../config');
const { findLapsedMembers, normalizeName } = require('../churn/ff_churn');

// Friendly Fire program adapter. Reads the FF tournament-stats sheet to detect
// lapsed players and surface their achievements + a "what changed" changelog.

const SEASON_TAB_RE = /^Season (\d+)$/;
const DISCORD_IDS_TAB = 'Discord IDs';
const FF_UPDATES_TAB = 'FF Updates';

// Season tab column layout (A:H): Name, Points, Blocks, Steals, Wins,
// Games Played, MMR, DiscordID.
const parseSeasonRow = (row) => {
    const inGameName = row[0] || '';
    if (!inGameName.trim()) {
        return null;
    }
    const discordId = (row[7] || '').trim() || null;
    return {
        inGameName,
        discordId,
        stats: {
            points: row[1] || '0',
            blocks: row[2] || '0',
            steals: row[3] || '0',
            wins: row[4] || '0',
            gamesPlayed: row[5] || '0',
            mmr: row[6] || '0',
        },
    };
};

const parseRoster = (rows) =>
    (rows || [])
        .slice(1)
        .map(parseSeasonRow)
        .filter(Boolean);

// Discord IDs tab: col 0 = in-game username, col 1 = discord id.
const buildIdLookup = (rows) => {
    const map = new Map();
    for (const row of (rows || []).slice(1)) {
        const name = normalizeName(row[0]);
        const id = (row[1] || '').trim();
        if (name && /^\d{15,}$/.test(id) && !map.has(name)) {
            map.set(name, id);
        }
    }
    return (inGameName) => map.get(normalizeName(inGameName)) || null;
};

const listSeasonNumbers = (metadata) =>
    (metadata.data.sheets || [])
        .map((s) => s.properties.title)
        .map((title) => {
            const match = SEASON_TAB_RE.exec(title);
            return match ? Number(match[1]) : null;
        })
        .filter((n) => n !== null)
        .sort((a, b) => b - a);

const hasTab = (metadata, title) =>
    (metadata.data.sheets || []).some((s) => s.properties.title === title);

async function loadSheetState() {
    const sheets = await getSheetsClient();
    const metadata = await sheets.spreadsheets.get({ spreadsheetId: config.FF_SHEET_ID });
    const seasonNumbers = listSeasonNumbers(metadata);
    if (seasonNumbers.length === 0) {
        throw new Error('No Season tabs found in FF sheet');
    }
    const currentSeason = seasonNumbers[0];

    // Fetch the current season plus the four prior seasons, and the id map.
    const wanted = [0, 1, 2, 3, 4]
        .map((offset) => currentSeason - offset)
        .filter((n) => seasonNumbers.includes(n));
    const seasonRanges = wanted.map((n) => `'Season ${n}'!A:H`);
    const ranges = [...seasonRanges, `'${DISCORD_IDS_TAB}'!A:B`];

    const response = await sheets.spreadsheets.values.batchGet({
        spreadsheetId: config.FF_SHEET_ID,
        ranges,
    });
    const valueRanges = response.data.valueRanges || [];

    const rostersBySeason = new Map();
    wanted.forEach((season, i) => {
        rostersBySeason.set(season, parseRoster(valueRanges[i]?.values));
    });
    const idLookup = buildIdLookup(valueRanges[wanted.length]?.values);

    return { sheets, metadata, currentSeason, rostersBySeason, idLookup };
}

// Finds a user's most recent appearance across all season tabs, for building a
// forced (test) target with real achievements.
async function findMostRecentAppearance(sheets, metadata, seasonNumbers, userId) {
    for (const season of seasonNumbers) {
        const range = `'Season ${season}'!A:H`;
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: config.FF_SHEET_ID,
            range,
        });
        const roster = parseRoster(res.data.values);
        const found = roster.find((entry) => entry.discordId === userId);
        if (found) {
            return { season, entry: found };
        }
    }
    return null;
}

const ffAdapter = {
    id: 'ff',
    label: 'Friendly Fire',
    staffThreadId: '1519867127396433960',
    registerLink: 'https://forms.gle/DKLWrwU9BzBMiT9X7',
    nextSessionInfo: 'Keep an eye on the server for the next Friendly Fire session.',

    async getLapsedMembers() {
        const { currentSeason, rostersBySeason, idLookup } = await loadSheetState();
        return findLapsedMembers({ rostersBySeason, currentSeason, idLookup });
    },

    async getChangelogSince(season) {
        try {
            const sheets = await getSheetsClient();
            const res = await sheets.spreadsheets.values.get({
                spreadsheetId: config.FF_SHEET_ID,
                range: `'${FF_UPDATES_TAB}'!A:C`,
            });
            const rows = (res.data.values || []).slice(1);
            return rows
                .filter((row) => Number(row[0]) > Number(season))
                .map((row) => {
                    const category = (row[1] || '').trim();
                    const summary = (row[2] || '').trim();
                    if (!summary) {
                        return null;
                    }
                    return category ? `${category}: ${summary}` : summary;
                })
                .filter(Boolean);
        } catch (error) {
            logger.warn(`[Reengage][FF] No changelog available: ${error.message}`);
            return [];
        }
    },

    // Test hook: build synthetic targets for specific users from their real
    // stats, using a simulated lapse season so the message fully populates.
    async getForcedTargets(userIds) {
        const { sheets, metadata, currentSeason } = await loadSheetState();
        const seasonNumbers = listSeasonNumbers(metadata);
        const simulatedSeason = config.FORCE_SIMULATED_LAST_SEASON;

        const targets = [];
        for (const userId of userIds) {
            const appearance = await findMostRecentAppearance(sheets, metadata, seasonNumbers, userId);
            targets.push({
                userId: String(userId),
                inGameName: appearance?.entry.inGameName || 'baller',
                lastActiveSeason: simulatedSeason,
                lapsedSeasons: Math.max(1, currentSeason - simulatedSeason),
                achievements: appearance?.entry.stats || { points: '0', wins: '0', mmr: '0' },
            });
        }
        return targets;
    },
};

module.exports = ffAdapter;
module.exports.hasTab = hasTab;
module.exports.FF_UPDATES_TAB = FF_UPDATES_TAB;
