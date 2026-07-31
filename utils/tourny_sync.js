'use strict';

const crypto = require('node:crypto');

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
// BIGINT/text id mismatches, as canSubmitReport does. Excludes final games:
// tourny 409s an assign push against a final game, and a final game belongs
// to requestsToComplete instead -- repairing it here would throw, abort
// syncLeague before the completion loop runs, and livelock the league's
// sweep forever.
function assignmentsToRepair(requests, gamesById) {
    return (requests || []).filter((r) => r.status === 'Assigned'
        && r.assigned_official_id
        && gamesById[r.tourny_game_id]
        && gamesById[r.tourny_game_id].status !== 'final'
        && String(gamesById[r.tourny_game_id].officialId || '') !== String(r.assigned_official_id));
}

// Assigned here and final in tourny: the game is settled, close the request.
function requestsToComplete(requests, gamesById) {
    return (requests || []).filter((r) => r.status === 'Assigned'
        && gamesById[r.tourny_game_id]
        && gamesById[r.tourny_game_id].status === 'final');
}

// Still Pending here but the game already went final in tourny: it was
// settled without an official (captains agreed, or staff ruled) before this
// request was ever assigned. Left open it eats the league's request cap
// forever and still shows a live Assign button -- and if staff assign it
// anyway, the request becomes Assigned-on-a-final-game, the exact state
// assignmentsToRepair now has to route around. Close it instead.
function requestsToCancel(requests, gamesById) {
    return (requests || []).filter((r) => r.status === 'Pending'
        && gamesById[r.tourny_game_id]
        && gamesById[r.tourny_game_id].status === 'final');
}

// Denied here, but tourny still shows the request's fingerprint: either the
// officialRequested flag never cleared (a denied Pending request), or the
// revoked official is still the game's assigned official in tourny (a
// denied Assigned request). Either way the deny-time clearOfficial push
// failed and must be repeated -- an uncleared officialRequested flag makes
// gamesNeedingRequests spawn a duplicate request for the same game next
// sweep, and an uncleared officialId leaves a revoked official with settle
// authority in tourny. A game tourny already shows as cleared is a no-op:
// filtered out, nothing to push.
function requestsToClear(deniedRequests, gamesById) {
    return (deniedRequests || []).filter((r) => {
        const game = gamesById[r.tourny_game_id];
        if (!game) {
            return false;
        }
        return Boolean(game.officialRequested)
            || (Boolean(r.assigned_official_id) && String(game.officialId || '') === String(r.assigned_official_id));
    });
}

// Every season a request needs serviced, plus the active season (if any).
// pickActiveSeason names one season to create requests against, but repair/
// complete/cancel/clear must keep working requests tied to a season that has
// since closed -- otherwise a league whose active season completes strands
// every open request linked to it. Requests with no season id (never linked)
// are ignored; they carry nothing to fetch games for.
function seasonsToService(requests, activeSeasonId) {
    const ids = new Set();
    for (const request of requests || []) {
        const seasonId = request && request.tourny_season_id;
        if (seasonId !== null && seasonId !== undefined) {
            ids.add(seasonId);
        }
    }
    if (activeSeasonId !== null && activeSeasonId !== undefined) {
        ids.add(activeSeasonId);
    }
    return [...ids];
}

// Games offered on /request-official's game-picker autocomplete: not final,
// no official assigned yet, and not already flagged for one -- the same
// "does this game actually need a request" question gamesNeedingRequests asks
// for the sweep, minus the linked-request check (nothing is linked yet; this
// IS how a link gets created).
function gamesEligibleForRequest(games) {
    return (games || []).filter((g) => g.status !== 'final' && !g.officialId && !g.officialRequested);
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

// Dashboard link for a linked request's game, so completion messages can
// point officials/requesters at the box score / stats surface tourny owns
// (see docs/superpowers/specs/2026-07-31-modal-stat-lines-design.md). Env is
// read per-call, not at require time like tourny_client.js, so tests can
// set/unset TOURNY_DASHBOARD_URL without a fresh module. Returns the
// composed "<base>/servers/<guildId> (game <gameId>)" string, or null when
// the request isn't linked (either tourny id missing) or the env var isn't
// set -- callers skip the stats-nudge line entirely on null.
function dashboardGameLink(request) {
    const base = (process.env.TOURNY_DASHBOARD_URL || '').replace(/\/$/, '');
    if (!base || !request?.tourny_game_id || !request?.tourny_guild_id) {
        return null;
    }
    return `${base}/servers/${request.tourny_guild_id} (game ${request.tourny_game_id})`;
}

// Shapes ballhead's roster rows into the wire body tourny's PUT
// /private/guilds/{gid}/officials-roster expects. Truncated/capped
// defensively here so a local oversize (a long staff-typed name, a roster
// that grew past 200) can never turn into a 400 from tourny -- the endpoint
// validates too, but this makes the push always well-formed on the way out.
function projectRoster(rows) {
    return (rows || []).slice(0, 200).map((row) => {
        const id = String(row.discord_id);
        const name = (row.discord_name || '').trim() || id;
        const sport = row.sport || '';
        return { id, name: name.slice(0, 100), sport: sport.slice(0, 60) };
    });
}

// Stable, order-insensitive fingerprint of a projected roster: sort by id so
// the same set in different row order hashes identically, then sha1 the JSON.
// Not security-sensitive -- just cheap change detection for the sweep's skip
// check -- so sha1 is fine.
function rosterHash(officials) {
    const sorted = [...(officials || [])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return crypto.createHash('sha1').update(JSON.stringify(sorted)).digest('hex');
}

module.exports = {
    pickActiveSeason,
    seasonsToService,
    gamesNeedingRequests,
    assignmentsToRepair,
    requestsToComplete,
    requestsToCancel,
    requestsToClear,
    gamesEligibleForRequest,
    buildAutoDetails,
    parseScore,
    dashboardGameLink,
    projectRoster,
    rosterHash,
};
