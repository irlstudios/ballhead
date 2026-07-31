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
} = require('../db');
const { postOfficialRequestCard, updateOpsCard, dmUser } = require('../handlers/league-officials');

// Guards against node-cron's lack of overlap protection: a cycle slower than
// the 5-minute interval must not run a second cycle on top of the first and
// double-create cards/DMs.
let running = false;

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

async function syncLeague(client, league, allLinked, allDenied) {
    const guildId = league.server_id;
    const seasons = await tourny.listSeasons(guildId);
    const season = sync.pickActiveSeason(seasons.seasons);
    if (!season) {
        return;
    }
    const games = (await tourny.listGames(guildId, season.seasonId)).games || [];
    const gamesById = Object.fromEntries(games.map((g) => [g.gameId, g]));
    const mine = allLinked.filter((r) => r.tourny_guild_id === guildId);
    const mineDenied = allDenied.filter((r) => r.tourny_guild_id === guildId);

    // Auto-created from a tourny-marked game, so it deliberately bypasses the
    // per-league open-request cap that /request-official enforces: these are
    // staff-visible work items tourny already knows about, not user-initiated
    // spam a cap needs to police.
    for (const game of sync.gamesNeedingRequests(games, mine)) {
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
