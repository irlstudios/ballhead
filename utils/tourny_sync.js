'use strict';

// Pure decisions for the tourny sync loop, in the utils/league_officials.js
// style: no HTTP, no DB, no Discord, so every rule is testable without mocks.
// The job (jobs/tourny-sync.js) and the handler pushes act on what these say.

// The season the sync watches: the newest one still open. Tourny statuses are
// scheduled around one active season at a time; a completed season's games are
// history, not work.
function pickActiveSeason(seasons) {
    const open = (seasons || []).filter((s) => s.status !== 'complete');
    if (!open.length) {
        return null;
    }
    return open.reduce((best, s) => ((s.createdAt || 0) > (best.createdAt || 0) ? s : best));
}

// Marked in tourny, not yet assigned there, no open linked request here, and
// not already final -- a game the captains settled themselves before ballhead
// swept it needs no official, and tourny's own assign endpoint 409s a final
// game anyway, so a request opened for one could never be fulfilled.
function gamesNeedingRequests(games, linkedRequests) {
    const linked = new Set((linkedRequests || []).map((r) => r.tourny_game_id));
    return (games || []).filter((g) => g.officialRequested && !g.officialId
        && g.status !== 'final' && !linked.has(g.gameId));
}

// Assigned here, but tourny shows a different (or no) official: the
// event-time push failed and must be repeated. String compare tolerates
// BIGINT/text id mismatches, as canSubmitReport does.
function assignmentsToRepair(requests, gamesById) {
    return (requests || []).filter((r) => r.status === 'Assigned'
        && r.assigned_official_id
        && gamesById[r.tourny_game_id]
        && String(gamesById[r.tourny_game_id].officialId || '') !== String(r.assigned_official_id));
}

// Assigned here and final in tourny: the game is settled, close the request.
function requestsToComplete(requests, gamesById) {
    return (requests || []).filter((r) => r.status === 'Assigned'
        && gamesById[r.tourny_game_id]
        && gamesById[r.tourny_game_id].status === 'final');
}

function buildAutoDetails(game, teamNames) {
    const names = teamNames || {};
    const home = names[game.homeTeamId] || game.homeTeamId;
    const away = names[game.awayTeamId] || game.awayTeamId;
    return `Week ${game.week}: ${home} vs ${away}`;
}

// Modal fields arrive as strings. Tourny caps scores at 9999.
function parseScore(value) {
    if (value === null || value === undefined) {
        return null;
    }
    const trimmed = String(value).trim();
    if (!/^\d{1,4}$/.test(trimmed)) {
        return null;
    }
    return Number(trimmed);
}

module.exports = {
    pickActiveSeason,
    gamesNeedingRequests,
    assignmentsToRepair,
    requestsToComplete,
    buildAutoDetails,
    parseScore,
};
