'use strict';

const { SlashCommandBuilder } = require('discord.js');
const logger = require('../../utils/logger');
const { noticePayload } = require('../../utils/ui');
const tourny = require('../../utils/tourny_client');
const {
    fetchLeaguesByOwner,
    fetchLeaguesByCoOwner,
    fetchCheckinForMonth,
    countOpenOfficialRequests,
    insertOfficialRequest,
    setOfficialRequestOpsMessage,
    deleteOfficialRequest,
} = require('../../db');
const {
    ELIGIBLE_TIERS,
    officialRequestEligibility,
    atOpenRequestCap,
} = require('../../utils/league_officials');
const { pickActiveSeason, gamesEligibleForRequest, buildAutoDetails } = require('../../utils/tourny_sync');
const { postOfficialRequestCard } = require('../../handlers/league-officials');

const SUB = 'Request Official';
const MAX_AUTOCOMPLETE_CHOICES = 25;

function currentMonth() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// Same resolution execute() has always used: prefer an already-eligible
// league, otherwise the first owned/co-owned one so the eligibility gate can
// explain why it is blocked. Shared with autocomplete so both agree on which
// league's games are in play.
async function resolveCallerLeague(userId) {
    const owned = await fetchLeaguesByOwner(userId);
    const coowned = await fetchLeaguesByCoOwner(userId);
    const all = [...owned, ...coowned];
    return all.find((l) => ELIGIBLE_TIERS.includes(l.league_type) && l.league_status === 'Active') || all[0] || null;
}

// Team names are cosmetic on the picker/card; ids are an acceptable fallback
// when the lookup fails (mirrors jobs/tourny-sync.js's createLinkedRequest).
async function fetchTeamNames(guildId) {
    try {
        const teams = (await tourny.listTeams(guildId)).teams || [];
        return Object.fromEntries(teams.map((t) => [t.teamId, t.name]));
    } catch {
        return {};
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('request-official')
        .setDescription('Request a community official for a league game (Active/Sponsored)')
        .addStringOption((o) => o.setName('sport').setDescription('Sport / format for the match').setRequired(true).setMaxLength(60))
        .addStringOption((o) => o.setName('details').setDescription('Opponent, event, or match context').setRequired(true).setMaxLength(300))
        .addStringOption((o) => o.setName('when').setDescription('Proposed date / time').setRequired(false).setMaxLength(120))
        .addStringOption((o) => o.setName('game')
            .setDescription('Link a specific tourny game (Active/Sponsored leagues on the tourny dashboard)')
            .setRequired(false).setMaxLength(100).setAutocomplete(true)),

    // Never allowed to throw or leave the interaction unanswered: a bad
    // autocomplete response cannot fail the slash command itself, and axios
    // errors carry the X-Api-Key header in err.config, so only err.message
    // is ever logged.
    async autocomplete(interaction) {
        try {
            const league = await resolveCallerLeague(interaction.user.id);
            if (!league || !league.server_id || !tourny.enabled()) {
                return interaction.respond([]);
            }

            const seasons = await tourny.listSeasons(league.server_id);
            const season = pickActiveSeason(seasons.seasons);
            if (!season) {
                return interaction.respond([]);
            }

            const games = (await tourny.listGames(league.server_id, season.seasonId)).games || [];
            const eligible = gamesEligibleForRequest(games);
            if (eligible.length === 0) {
                return interaction.respond([]);
            }

            const teamNames = await fetchTeamNames(league.server_id);
            const typed = (interaction.options.getFocused() || '').toLowerCase();
            const choices = eligible
                .map((game) => ({ name: buildAutoDetails(game, teamNames), value: `${season.seasonId}|${game.gameId}` }))
                .filter((choice) => choice.name.toLowerCase().includes(typed))
                .slice(0, MAX_AUTOCOMPLETE_CHOICES);

            return interaction.respond(choices);
        } catch (error) {
            logger.error('[Officials] request-official autocomplete failed:', error.message);
            return interaction.respond([]).catch(() => {});
        }
    },

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const userId = interaction.user.id;
            const league = await resolveCallerLeague(userId);

            let hasCurrentCheckin = false;
            if (league) {
                const checkins = await fetchCheckinForMonth(league.league_id, currentMonth());
                hasCurrentCheckin = checkins.length > 0;
            }

            const gate = officialRequestEligibility(league, { hasCurrentCheckin });
            if (!gate.ok) {
                return interaction.editReply(noticePayload(gate.message, { title: gate.title, subtitle: SUB }));
            }

            // ponytail: soft anti-spam cap, checked non-atomically. A rare
            // concurrent burst may exceed it by a few; acceptable for a spam gate.
            const openCount = await countOpenOfficialRequests(league.league_id);
            if (atOpenRequestCap(openCount)) {
                return interaction.editReply(noticePayload(
                    `Your league already has ${openCount} open requests (the max). Wait for one to be assigned or completed first.`,
                    { title: 'Too Many Open Requests', subtitle: SUB }
                ));
            }

            // Linking a specific tourny game is optional. Unset, this whole block
            // is skipped and behavior is byte-for-byte the unlinked path below.
            let tournyLink = null;
            let matchDetails = interaction.options.getString('details');

            const gameOption = interaction.options.getString('game');
            if (gameOption) {
                const parts = gameOption.split('|');
                if (parts.length !== 2 || !parts[0] || !parts[1]) {
                    return interaction.editReply(noticePayload(
                        'That game selection is invalid. Pick one from the autocomplete list.',
                        { title: 'Invalid Game', subtitle: SUB }
                    ));
                }
                const [seasonId, gameId] = parts;

                if (!league.server_id || !tourny.enabled()) {
                    return interaction.editReply(noticePayload(
                        'Linking a tourny game is not available right now.',
                        { title: 'Game Linking Unavailable', subtitle: SUB }
                    ));
                }

                let game;
                try {
                    const result = await tourny.getGame(league.server_id, gameId, seasonId);
                    game = result && result.game;
                } catch (gameErr) {
                    if (gameErr.response && gameErr.response.status === 404) {
                        return interaction.editReply(noticePayload(
                            'That game could not be found.',
                            { title: 'Game Not Found', subtitle: SUB }
                        ));
                    }
                    // A linked request must never be created unverified, so this
                    // creates nothing rather than guessing the game is fine.
                    logger.error('[Officials] game validation failed:', gameErr.message);
                    return interaction.editReply(noticePayload(
                        'Could not verify that game right now. Try again in a minute.',
                        { title: 'Validation Failed', subtitle: SUB }
                    ));
                }
                if (!game) {
                    return interaction.editReply(noticePayload(
                        'That game could not be found.',
                        { title: 'Game Not Found', subtitle: SUB }
                    ));
                }
                if (game.status === 'final') {
                    return interaction.editReply(noticePayload(
                        'Could not link this request: that game is already final.',
                        { title: 'Game Already Final', subtitle: SUB }
                    ));
                }
                if (game.officialId) {
                    return interaction.editReply(noticePayload(
                        'Could not link this request: an official is already assigned to that game.',
                        { title: 'Official Already Assigned', subtitle: SUB }
                    ));
                }

                const teamNames = await fetchTeamNames(league.server_id);
                matchDetails = `${buildAutoDetails(game, teamNames)} — ${matchDetails}`;
                tournyLink = { tournyGuildId: league.server_id, tournySeasonId: seasonId, tournyGameId: gameId };
            }

            const request = await insertOfficialRequest({
                leagueId: league.league_id,
                requestedBy: userId,
                sport: interaction.options.getString('sport'),
                matchDetails,
                proposedTime: interaction.options.getString('when'),
                ...tournyLink,
            });

            try {
                const message = await postOfficialRequestCard(interaction.client, request, league.league_name);
                await setOfficialRequestOpsMessage(request.id, message.id);
            } catch (postErr) {
                // Roll back the orphan so it does not silently consume the cap.
                await deleteOfficialRequest(request.id).catch(() => {});
                throw postErr;
            }

            if (tournyLink) {
                // Fire-and-forget: the dashboard badge is cosmetic, and staff can
                // already see this request on the ops card either way.
                tourny.requestOfficialMark(tournyLink.tournyGuildId, tournyLink.tournyGameId, tournyLink.tournySeasonId, userId)
                    .catch((markErr) => logger.error('[Officials] request-official mark push:', markErr.message));
            }

            logger.info(`[Officials] Request ${request.id} created by ${userId} for league ${league.league_id}`);
            return interaction.editReply(noticePayload(
                [
                    `Your request (**#${request.id}**) has been posted for staff to assign an official.`,
                    'You will be DMed when it is assigned and again when the game is verified.',
                ],
                { title: 'Official Requested', subtitle: SUB }
            ));
        } catch (error) {
            logger.error('[Officials] request-official failed:', error);
            return interaction.editReply(noticePayload('An error occurred while creating your request.', { title: 'Request Failed', subtitle: SUB }));
        }
    },
};
