'use strict';

const axios = require('axios');

// Thin client for tourny_tool's /private surface. This module knows URLs and
// the API key; it holds no sync policy, so it needs no tests of its own --
// the decisions live in utils/tourny_sync.js.

const baseUrl = (process.env.TOURNY_API_URL || '').replace(/\/$/, '');
const apiKey = process.env.TOURNY_API_KEY || '';

function enabled() {
    return Boolean(baseUrl && apiKey);
}

async function call(method, path, body) {
    const res = await axios({
        method,
        url: `${baseUrl}${path}`,
        data: body,
        headers: { 'X-Api-Key': apiKey },
        timeout: 10000,
    });
    return res.data;
}

const listSeasons = (guildId) => call('get', `/private/guilds/${guildId}/seasons`);
const listGames = (guildId, seasonId) =>
    call('get', `/private/guilds/${guildId}/games?seasonId=${encodeURIComponent(seasonId)}`);
const listTeams = (guildId) => call('get', `/private/guilds/${guildId}/teams`);
const getGame = (guildId, gameId, seasonId) =>
    call('get', `/private/guilds/${guildId}/games/${gameId}?seasonId=${encodeURIComponent(seasonId)}`);
const assignOfficial = (guildId, gameId, seasonId, officialId) =>
    call('post', `/private/guilds/${guildId}/games/${gameId}/official`, { seasonId, officialId });
const clearOfficial = (guildId, gameId, seasonId) =>
    call('delete', `/private/guilds/${guildId}/games/${gameId}/official`, { seasonId });
const reportAsOfficial = (guildId, gameId, { seasonId, actorId, homeScore, awayScore }) =>
    call('post', `/private/guilds/${guildId}/games/${gameId}/report`, {
        seasonId, actorId, staff: false, homeScore, awayScore, lines: [],
    });
// Marks a game as needing a hub official, from the /request-official game
// picker, so the dashboard badge lights up. Assignment itself only ever
// happens through assignOfficial once staff pick someone.
const requestOfficialMark = (guildId, gameId, seasonId, requestedBy) =>
    call('post', `/private/guilds/${guildId}/games/${gameId}/request-official`, { seasonId, requestedBy });
// Full replace of the hub officials roster tourny shows for this guild, from
// the sweep's roster pass (utils/tourny_sync.js). officials: [{id, name, sport}].
const putOfficialsRoster = (guildId, officials) =>
    call('put', `/private/guilds/${guildId}/officials-roster`, { officials });

module.exports = {
    enabled, listSeasons, listGames, listTeams, getGame,
    assignOfficial, clearOfficial, reportAsOfficial, requestOfficialMark, putOfficialsRoster,
};
