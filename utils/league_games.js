'use strict';

// Pure logic for owner-submitted league games and the weekly stats surfaces
// (/submit-game, /league-games, /league-overview). No Discord or DB work so
// every rule is unit-testable, mirroring utils/league_officials.js.

// A game complete needs at least two tagged players to mean anything; the cap
// keeps one submission from flooding the metrics with a whole server.
const MIN_PLAYERS_PER_GAME = 2;
const MAX_PLAYERS_PER_GAME = 25;

// Status written to league_games for owner/co-owner submissions, distinct from
// the officials flow's 'Official Verified'.
const OWNER_REPORTED_STATUS = 'Owner Reported';

// Discord mentions (<@id> / <@!id>) or bare snowflake ids, deduped in order.
const PLAYER_TOKEN = /<@!?(\d{17,20})>|\b(\d{17,20})\b/g;

function parsePlayerIds(raw) {
    if (!raw || typeof raw !== 'string') {
        return [];
    }
    const ids = [];
    for (const match of raw.matchAll(PLAYER_TOKEN)) {
        const id = match[1] || match[2];
        if (!ids.includes(id)) {
            ids.push(id);
        }
    }
    return ids;
}

function deny(code, title, message) {
    return Object.freeze({ ok: false, code, title, message });
}

const ALLOW = Object.freeze({ ok: true, code: 'OK', title: null, message: null });

function validateGameSubmission({ league, playerIds }) {
    if (!league) {
        return deny('NO_LEAGUE', 'No League Found', 'You do not own or co-own a registered league.');
    }
    const ids = Array.isArray(playerIds) ? playerIds : [];
    if (ids.length < MIN_PLAYERS_PER_GAME) {
        return deny(
            'TOO_FEW_PLAYERS',
            'Not Enough Players',
            `Tag at least ${MIN_PLAYERS_PER_GAME} players (@mention them in the players field).`
        );
    }
    if (ids.length > MAX_PLAYERS_PER_GAME) {
        return deny(
            'TOO_MANY_PLAYERS',
            'Too Many Players',
            `Tag at most ${MAX_PLAYERS_PER_GAME} players per game.`
        );
    }
    return ALLOW;
}

function isoDate(value) {
    return new Date(value).toISOString().slice(0, 10);
}

// Rows: { week_start, games, players }, already newest-first from the query.
function buildWeeklyStatsLines(rows) {
    if (!rows || rows.length === 0) {
        return ['No games recorded in the last 4 weeks.'];
    }
    return rows.map((r) => {
        const games = Number(r.games) || 0;
        const players = Number(r.players) || 0;
        return `- Week of ${isoDate(r.week_start)}: **${games}** ${games === 1 ? 'game' : 'games'}, **${players}** unique players`;
    });
}

// Rows: { league_name, league_hashtag, games_7d, players_7d }.
function buildOverviewLines(rows) {
    if (!rows || rows.length === 0) {
        return ['No registered leagues found.'];
    }
    return rows.map((r) => {
        const tag = r.league_hashtag ? `#${r.league_hashtag}` : 'no hashtag';
        return `- **${r.league_name}** (${tag}) — ${Number(r.games_7d) || 0} games, ${Number(r.players_7d) || 0} unique players (last 7 days)`;
    });
}

// Split lines into groups whose joined length stays under maxChars, so long
// lists fit Discord's 4000-character text display limit across messages.
function chunkLines(lines, maxChars = 3500) {
    const chunks = [];
    let current = [];
    let size = 0;
    for (const line of lines) {
        if (current.length > 0 && size + line.length + 1 > maxChars) {
            chunks.push(current);
            current = [];
            size = 0;
        }
        current.push(line);
        size += line.length + 1;
    }
    if (current.length > 0) {
        chunks.push(current);
    }
    return chunks;
}

module.exports = {
    MIN_PLAYERS_PER_GAME,
    MAX_PLAYERS_PER_GAME,
    OWNER_REPORTED_STATUS,
    parsePlayerIds,
    validateGameSubmission,
    buildWeeklyStatsLines,
    buildOverviewLines,
    chunkLines,
};
