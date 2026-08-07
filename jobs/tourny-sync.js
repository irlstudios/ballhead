'use strict';

const logger = require('../utils/logger');
const tourny = require('../utils/tourny_client');
const sync = require('../utils/tourny_sync');
const {
    fetchActiveLeagues,
    fetchOpenLinkedRequests,
    fetchRecentDeniedLinkedRequests,
    fetchRequestByTournyGame,
    insertOfficialRequest,
    setOfficialRequestOpsMessage,
    deleteOfficialRequest,
    completeOfficialRequestWithReport,
    cancelPendingOfficialRequest,
    listRosterOfficials,
} = require('../db');
const { postOfficialRequestCard, updateOpsCard, dmUser } = require('../handlers/league-officials');

// Guards against node-cron's lack of overlap protection: a cycle slower than
// the 5-minute interval must not run a second cycle on top of the first and
// double-create cards/DMs.
let running = false;

// Fingerprint of the officials roster last successfully pushed to every
// serviced guild. Module-scoped, so it resets on process restart -- costing
// one redundant push burst per restart, which the idempotent PUT absorbs.
let lastRosterHash = null;

// One sweep of every active league's tourny games:
//   marked games          -> create a linked request + ops card
//   missed assign push    -> repair (push again)
//   missed deny/clear push -> repair (push clearOfficial again)
//   game final in tourny, request Assigned -> complete the request
//   game final in tourny, request still Pending -> cancel the request
// Ballhead's DB is the source of truth for requests; tourny's for games. Every
// action here is idempotent, so a failed sweep costs one interval, not data.
async function runTournySync(client) {
    if (!tourny.enabled()) {
        return;
    }
    if (running) {
        logger.warn('[TournySync] previous sweep still running, skipping this tick');
        return;
    }
    running = true;
    try {
        let leagues;
        let linked;
        let denied;
        try {
            leagues = await fetchActiveLeagues();
            linked = await fetchOpenLinkedRequests();
            denied = await fetchRecentDeniedLinkedRequests();
        } catch (error) {
            logger.error('[TournySync] sweep aborted, cannot read own DB:', error.message);
            return;
        }
        await syncOfficialsRoster(leagues);
        for (const league of leagues) {
            if (!league.server_id) {
                continue;
            }
            try {
                await syncLeague(client, league, linked, denied);
            } catch (error) {
                // Per-league isolation: one unreachable guild must not starve the rest.
                logger.error(`[TournySync] league ${league.league_id}:`, error.message);
            }
        }
    } finally {
        running = false;
    }
}

// Mirrors ballhead's active officials roster to every guild the sweep
// services, so tourny's dashboard can show managers who the hub's officials
// are (docs/superpowers/specs/2026-07-31-officials-roster-visibility-design.md).
// Runs once per sweep, before the per-league loop, and is skipped outright
// when the roster's content hasn't changed since the last fully-successful
// push. lastRosterHash only advances when every push attempted this sweep
// succeeded, so one unreachable guild costs a retry, not a stale roster
// everywhere else.
async function syncOfficialsRoster(leagues) {
    let rows;
    try {
        rows = await listRosterOfficials();
    } catch (error) {
        logger.error('[TournySync] roster pass aborted, cannot read own DB:', error.message);
        return;
    }
    const officials = sync.projectRoster(rows);
    const hash = sync.rosterHash(officials);
    if (hash === lastRosterHash) {
        return;
    }
    const guildIds = [...new Set((leagues || []).filter((l) => l.server_id).map((l) => l.server_id))];
    if (!guildIds.length) {
        // Nothing to push to yet; leave lastRosterHash untouched so a league
        // showing up later still gets the current roster pushed.
        return;
    }
    let allOk = true;
    for (const guildId of guildIds) {
        try {
            await tourny.putOfficialsRoster(guildId, officials);
        } catch (error) {
            // err.message only -- the raw axios error carries the API key in
            // its request config.
            allOk = false;
            logger.error(`[TournySync] roster push failed for guild ${guildId}:`, error.message);
        }
    }
    if (allOk) {
        lastRosterHash = hash;
    }
}

async function syncLeague(client, league, allLinked, allDenied) {
    const guildId = league.server_id;
    const seasons = await tourny.listSeasons(guildId);
    const season = sync.pickActiveSeason(seasons.seasons);
    const mine = allLinked.filter((r) => r.tourny_guild_id === guildId);
    const mineDenied = allDenied.filter((r) => r.tourny_guild_id === guildId);

    // Service every season these requests reference, not just the active
    // one: a league whose active season completes must not strand open or
    // denied requests linked to the season that just closed.
    const activeSeasonId = season ? season.seasonId : null;
    const seasonIds = sync.seasonsToService([...mine, ...mineDenied], activeSeasonId);
    if (!seasonIds.length) {
        return;
    }

    // activeGames feeds only the create pass below (a completed season's
    // unplayed games must never spawn a request); gamesById is the merged
    // view every other pass reads.
    let activeGames = [];
    const gamesById = {};
    for (const seasonId of seasonIds) {
        let games;
        try {
            games = (await tourny.listGames(guildId, seasonId)).games || [];
        } catch (error) {
            // Per-season isolation: one unreachable/removed season must not
            // stop the rest of this league's sweep.
            logger.error(`[TournySync] league ${league.league_id} season ${seasonId}:`, error.message);
            continue;
        }
        if (seasonId === activeSeasonId) {
            activeGames = games;
        }
        for (const game of games) {
            gamesById[game.gameId] = game;
        }
    }

    // Auto-created from a tourny-marked game, so it deliberately bypasses the
    // per-league open-request cap that /league request-official enforces: these are
    // staff-visible work items tourny already knows about, not user-initiated
    // spam a cap needs to police.
    for (const game of sync.gamesNeedingRequests(activeGames, mine)) {
        await createLinkedRequest(client, league, season, game, guildId);
    }
    for (const request of sync.assignmentsToRepair(mine, gamesById)) {
        await tourny.assignOfficial(guildId, request.tourny_game_id, request.tourny_season_id, request.assigned_official_id);
        logger.info(`[TournySync] repaired assignment push for request ${request.id}`);
    }
    for (const request of sync.requestsToClear(mineDenied, gamesById)) {
        await tourny.clearOfficial(guildId, request.tourny_game_id, request.tourny_season_id);
        logger.info(`[TournySync] repaired deny/clear push for request ${request.id}`);
    }
    for (const request of sync.requestsToComplete(mine, gamesById)) {
        const dashboardUrl = process.env.TOURNY_DASHBOARD_URL;
        const completed = await completeOfficialRequestWithReport(request.id, request.assigned_official_id, {
            proofUrl: dashboardUrl ? `${dashboardUrl}/servers/${guildId}` : 'verified-in-tourny-dashboard',
            notes: 'Result verified in the tourny dashboard.',
        });
        if (!completed) {
            // Claim already lost to a concurrent completion; nothing to notify.
            continue;
        }
        logger.info(`[TournySync] completed request ${request.id} (game final in tourny)`);
        // Mirror the staff report-submit path (handlers/league-officials.js):
        // flip the ops card to its terminal state and DM the requester. Both
        // helpers already catch and log .message-only internally, so a
        // Discord-side failure here cannot fail the sweep.
        await updateOpsCard(client, completed, league.league_name);
        // null when TOURNY_DASHBOARD_URL is unset; filter(Boolean) inside
        // buildTextBlock drops a null line, so the DM is unchanged then.
        const viewLink = sync.dashboardGameLink(completed);
        await dmUser(client, completed.requested_by, {
            title: 'Game Verified',
            subtitle: league.league_name,
            lines: [
                `Your official request #${completed.id} is complete and the game is verified.`,
                viewLink && `See the result and box score: ${viewLink}`,
            ],
        });
    }
    for (const request of sync.requestsToCancel(mine, gamesById)) {
        const reason = 'Game was settled without an official';
        // cancelPendingOfficialRequest (not denyOfficialRequest) only claims
        // a still-Pending row: `mine` is a snapshot taken once per sweep, so
        // by the time this runs staff may have assigned the request. Losing
        // that race returns null and must not deny an Assigned request.
        const cancelled = await cancelPendingOfficialRequest(request.id, reason, 'tourny-sync');
        if (!cancelled) {
            // Claim already lost to a concurrent assign/deny; nothing to notify.
            continue;
        }
        logger.info(`[TournySync] cancelled stale pending request ${cancelled.id} (game settled without an official)`);
        await updateOpsCard(client, cancelled, league.league_name);
        await dmUser(client, cancelled.requested_by, {
            title: 'Official Request Cancelled',
            subtitle: league.league_name,
            lines: [`Your official request #${cancelled.id} was cancelled: ${reason.toLowerCase()}.`],
        });
    }
}

async function createLinkedRequest(client, league, season, game, guildId) {
    // Just-before-insert recheck: closes the same-sweep duplicate window when
    // two Active league rows share one server_id, so both would otherwise
    // pass gamesNeedingRequests off the same linked-request snapshot before
    // either one's insert lands.
    const existing = await fetchRequestByTournyGame(guildId, game.gameId);
    if (existing) {
        return;
    }
    let teamNames = {};
    try {
        const teams = (await tourny.listTeams(guildId)).teams || [];
        teamNames = Object.fromEntries(teams.map((t) => [t.teamId, t.name]));
    } catch {
        // Names are cosmetic on the card; ids are an acceptable fallback.
    }
    const request = await insertOfficialRequest({
        leagueId: league.league_id,
        requestedBy: game.officialRequestedBy || league.owner_id,
        sport: league.league_name,
        matchDetails: sync.buildAutoDetails(game, teamNames),
        proposedTime: game.scheduledAt ? `<t:${game.scheduledAt}:F>` : null,
        tournyGuildId: guildId,
        tournySeasonId: season.seasonId,
        tournyGameId: game.gameId,
    });
    try {
        const message = await postOfficialRequestCard(client, request, league.league_name);
        await setOfficialRequestOpsMessage(request.id, message.id);
    } catch (postErr) {
        // Same rollback the slash command does: no orphan rows eating the cap.
        await deleteOfficialRequest(request.id).catch(() => {});
        throw postErr;
    }
    logger.info(`[TournySync] request ${request.id} created for tourny game ${game.gameId}`);
}

module.exports = { runTournySync };
