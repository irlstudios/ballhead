'use strict';

const logger = require('../utils/logger');
const tourny = require('../utils/tourny_client');
const sync = require('../utils/tourny_sync');
const {
    fetchActiveLeagues,
    fetchOpenLinkedRequests,
    insertOfficialRequest,
    setOfficialRequestOpsMessage,
    deleteOfficialRequest,
    completeOfficialRequestWithReport,
} = require('../db');
const { postOfficialRequestCard, updateOpsCard, dmUser } = require('../handlers/league-officials');

// One sweep of every active league's tourny games:
//   marked games        -> create a linked request + ops card
//   missed assign push  -> repair (push again)
//   game final in tourny -> complete the request
// Ballhead's DB is the source of truth for requests; tourny's for games. Every
// action here is idempotent, so a failed sweep costs one interval, not data.
async function runTournySync(client) {
    if (!tourny.enabled()) {
        return;
    }
    let leagues;
    let linked;
    try {
        leagues = await fetchActiveLeagues();
        linked = await fetchOpenLinkedRequests();
    } catch (error) {
        logger.error('[TournySync] sweep aborted, cannot read own DB:', error.message);
        return;
    }
    for (const league of leagues) {
        if (!league.server_id) {
            continue;
        }
        try {
            await syncLeague(client, league, linked);
        } catch (error) {
            // Per-league isolation: one unreachable guild must not starve the rest.
            logger.error(`[TournySync] league ${league.league_id}:`, error.message);
        }
    }
}

async function syncLeague(client, league, allLinked) {
    const guildId = league.server_id;
    const seasons = await tourny.listSeasons(guildId);
    const season = sync.pickActiveSeason(seasons.seasons);
    if (!season) {
        return;
    }
    const games = (await tourny.listGames(guildId, season.seasonId)).games || [];
    const gamesById = Object.fromEntries(games.map((g) => [g.gameId, g]));
    const mine = allLinked.filter((r) => r.tourny_guild_id === guildId);

    for (const game of sync.gamesNeedingRequests(games, mine)) {
        await createLinkedRequest(client, league, season, game, guildId);
    }
    for (const request of sync.assignmentsToRepair(mine, gamesById)) {
        await tourny.assignOfficial(guildId, request.tourny_game_id, request.tourny_season_id, request.assigned_official_id);
        logger.info(`[TournySync] repaired assignment push for request ${request.id}`);
    }
    for (const request of sync.requestsToComplete(mine, gamesById)) {
        const completed = await completeOfficialRequestWithReport(request.id, request.assigned_official_id, {
            proofUrl: `${process.env.TOURNY_DASHBOARD_URL || ''}/servers/${guildId}`,
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
        await dmUser(client, completed.requested_by, {
            title: 'Game Verified',
            subtitle: league.league_name,
            lines: [`Your official request #${completed.id} is complete and the game is verified.`],
        });
    }
}

async function createLinkedRequest(client, league, season, game, guildId) {
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
