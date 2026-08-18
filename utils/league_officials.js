'use strict';

const { URL } = require('node:url');

// Pure logic for the league officials + games loop (Phase 2). No Discord or DB
// work happens here so every rule is unit-testable without mocks, mirroring
// utils/league_disband.js. The DB layer (db.js) and handler glue enforce the
// same rules with atomic SQL; this module is the single source of the decisions.

// A league may hold at most this many open (Pending/Assigned) official requests
// at once. Concurrent games are fine; runaway spam is not.
const MAX_OPEN_REQUESTS_PER_LEAGUE = 5;

// Request lifecycle: Pending -> Assigned -> Completed, or Pending -> Denied.
const REQUEST_STATUS = Object.freeze({
    PENDING: 'Pending',
    ASSIGNED: 'Assigned',
    COMPLETED: 'Completed',
    DENIED: 'Denied',
});

// "Open" = still counts against the per-league cap and can still be assigned or
// denied. Completed and Denied are terminal.
const OPEN_STATUSES = Object.freeze([REQUEST_STATUS.PENDING, REQUEST_STATUS.ASSIGNED]);

// Only these tiers may request officials (Base is directory-only).
const ELIGIBLE_TIERS = Object.freeze(['Active', 'Sponsored']);

// The verification label written to league_games when an official's report is
// accepted. Games-played metric counts rows with a verified status.
const VERIFIED_STATUS = 'Official Verified';

function deny(code, title, message) {
    return Object.freeze({ ok: false, code, title, message });
}

const ALLOW = Object.freeze({ ok: true, code: 'OK', title: null, message: null });

// Format-only validation: confirms an http(s) URL, not that it is reachable or
// contains real match footage. Human review remains the real verification.
function isValidHttpUrl(value) {
    if (!value || typeof value !== 'string') {
        return false;
    }
    let url;
    try {
        url = new URL(value.trim());
    } catch {
        return false;
    }
    return url.protocol === 'http:' || url.protocol === 'https:';
}

// Gate for /league request-official. `league` is the caller's owned/co-owned league (or
// null). `hasCurrentCheckin` reflects whether this month's check-in is on file
// (the confirmed policy: a check-in is required before requesting).
function officialRequestEligibility(league, { hasCurrentCheckin = false } = {}) {
    if (!league) {
        return deny('NO_LEAGUE', 'No League Found', 'You do not own or co-own a registered league.');
    }
    if (league.league_type === 'Base') {
        return deny(
            'BASE_TIER',
            'Active Tier Required',
            'Base leagues are directory-only. Upgrade to Active before requesting officials.'
        );
    }
    if (!ELIGIBLE_TIERS.includes(league.league_type)) {
        return deny('INELIGIBLE_TIER', 'Ineligible League', 'Only Active or Sponsored leagues can request officials.');
    }
    if (league.league_status !== 'Active') {
        return deny(
            'NOT_ACTIVE',
            'League Not Active',
            'Your league must be Active to request officials. Submit a `/league checkin` to reactivate it.'
        );
    }
    if (!hasCurrentCheckin) {
        return deny(
            'NO_CHECKIN',
            'Check-in Required',
            'Submit this month\'s `/league checkin` before requesting an official.'
        );
    }
    return ALLOW;
}

// True when the league has hit the open-request cap and must not create more.
function atOpenRequestCap(openCount) {
    return (Number(openCount) || 0) >= MAX_OPEN_REQUESTS_PER_LEAGUE;
}

// Assigned-official-only reporting guard, checked at both the button and the
// modal submit. A stringified compare tolerates BIGINT/text id mismatches.
function canSubmitReport(request, userId) {
    if (!request) {
        return deny('NO_REQUEST', 'Request Not Found', 'This official request no longer exists.');
    }
    if (request.status !== REQUEST_STATUS.ASSIGNED) {
        return deny('NOT_OPEN', 'Not Awaiting Report', 'This request is not currently awaiting a report.');
    }
    if (String(request.assigned_official_id) !== String(userId)) {
        return deny('NOT_ASSIGNED', 'Not the Assigned Official', 'Only the assigned official can submit this report.');
    }
    return ALLOW;
}

// Approval gate for the ops-channel Assign/Deny buttons: staff must be acting
// inside the Gym Class guild and hold the Community Director role there. Pure
// so the handler wrapper (staffCanManage) stays a thin adapter over
// interaction.guildId / interaction.member.roles.cache.
function canApproveOfficialRequest({ guildId, memberRoleIds } = {}, { gcGuildId, cdRoleId } = {}) {
    if (guildId !== gcGuildId) {
        return false;
    }
    if (!memberRoleIds || typeof memberRoleIds.has !== 'function') {
        return false;
    }
    return memberRoleIds.has(cdRoleId);
}

// Self-service cancel guard for the requester-facing Cancel Request button on
// the /league request-official confirmation. Permission first (only the original
// requester), then state (only while still Pending -- once staff assign or
// close it, withdrawal goes through a CD). The DB claim
// (cancelPendingOfficialRequest) re-enforces the Pending gate atomically; this
// pure check exists to give the requester a precise refusal message. A
// stringified compare tolerates BIGINT/text id mismatches, as in canSubmitReport.
function canCancelOfficialRequest(request, userId) {
    if (!request) {
        return deny('NO_REQUEST', 'Request Not Found', 'This official request no longer exists.');
    }
    if (String(request.requested_by) !== String(userId)) {
        return deny('NOT_REQUESTER', 'Not Your Request', 'Only the person who made this request can cancel it.');
    }
    if (request.status !== REQUEST_STATUS.PENDING) {
        return deny(
            'NOT_PENDING',
            'No Longer Pending',
            'This request has already been assigned or closed. Ask a Community Director if it still needs to be withdrawn.'
        );
    }
    return ALLOW;
}

// A roster official can be offered for a request when they are active and their
// sport is "Any" or matches the request's sport (case-insensitive).
function officialMatchesSport(rosterSport, requestSport) {
    const rs = (rosterSport || '').trim().toLowerCase();
    if (rs === '' || rs === 'any') {
        return true;
    }
    return rs === (requestSport || '').trim().toLowerCase();
}

// Pure card body for the ops-channel request card. Kept here so the handler
// stays thin and the wording is testable.
function buildRequestCardLines(request, { leagueName } = {}) {
    const lines = [
        `**League:** ${leagueName || 'Unknown'}`,
        `**Requested by:** <@${request.requested_by}>`,
        `**Sport:** ${request.sport || 'Any'}`,
        `**Details:** ${request.match_details || 'None provided'}`,
        `**Proposed time:** ${request.proposed_time || 'Not specified'}`,
        `**Status:** ${request.status}`,
    ];
    if (request.status === REQUEST_STATUS.ASSIGNED && request.assigned_official_id) {
        lines.push(`**Assigned official:** <@${request.assigned_official_id}>`);
    }
    if (request.status === REQUEST_STATUS.DENIED && request.denial_reason) {
        lines.push(`**Denial reason:** ${request.denial_reason}`);
    }
    return lines;
}

// One-line games summary for /league games and the monthly check-in.
function buildGamesSummaryLine({ verified = 0, reported = 0 } = {}) {
    return `Verified games: **${verified}** | Total reported: **${reported}**`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Coarse relative-time label for the assignment picker ("3d", "2w", "5mo").
// utils/reports_logic.js already has formatAge, but it buckets in hours/days
// only and reads "under an hour" / "23h" -- fine for a report that's hours
// old, wrong shape for an official who last worked a game months ago. This
// stays day-granularity-and-up on purpose: games are days apart at the
// closest, so hours/minutes buckets would never fire.
function shortAgo(then, now = Date.now()) {
    const nowMs = now instanceof Date ? now.getTime() : now;
    const thenMs = then instanceof Date ? then.getTime() : new Date(then).getTime();
    const days = Math.floor(Math.max(0, nowMs - thenMs) / DAY_MS);
    if (days < 1) {
        return 'today';
    }
    if (days < 7) {
        return `${days}d`;
    }
    if (days < 30) {
        return `${Math.floor(days / 7)}w`;
    }
    return `${Math.floor(days / 30)}mo`;
}

// Assignment-picker option description. rosterRow is a fetchAvailableOfficials
// row (carries the offerable sport). trackRecord is tri-state, matching how
// showAssignSelect distinguishes "we don't know" from "we checked and it's
// zero": null means the track-record fetch failed/is unavailable (degrade to
// the plain pre-enrichment description, since labeling every official "new"
// would be actively misleading); undefined or a { games: 0 } row means the
// fetch succeeded and this official has no games in league_game_reports.
// Zero deliberately reads "no tracked games yet", not "new": the count only
// covers pipeline games (league_game_reports starts at the Phase 2 request
// flow), and no legacy per-official record exists anywhere in this codebase
// to backfill from -- ff_official_applications.officiating_duration is a
// free-text application answer, host_sessions is the EMH hosting program
// (not officiating), and the officials/host Google Sheets hold applications
// and weekly hosting rosters, not per-official game counts. A veteran from
// before the pipeline therefore legitimately sits at zero, and the copy must
// not misrepresent them as brand new. Discord caps option descriptions at
// 100 chars; sliced here rather than by the caller, matching the
// .slice(0, 100) idiom already used on the label in showAssignSelect.
function officialOptionDescription(rosterRow, trackRecord, now = Date.now()) {
    const sport = rosterRow?.sport || 'Any';
    if (trackRecord === null) {
        return `Sport: ${sport}`.slice(0, 100);
    }
    const games = Number(trackRecord?.games) || 0;
    if (games === 0) {
        return `Sport: ${sport} | no tracked games yet`.slice(0, 100);
    }
    const description = `Sport: ${sport} | ${games} games | last ${shortAgo(trackRecord.last_active, now)}`;
    return description.slice(0, 100);
}

module.exports = {
    MAX_OPEN_REQUESTS_PER_LEAGUE,
    REQUEST_STATUS,
    OPEN_STATUSES,
    ELIGIBLE_TIERS,
    VERIFIED_STATUS,
    isValidHttpUrl,
    officialRequestEligibility,
    atOpenRequestCap,
    canApproveOfficialRequest,
    canCancelOfficialRequest,
    canSubmitReport,
    officialMatchesSport,
    buildRequestCardLines,
    buildGamesSummaryLine,
    shortAgo,
    officialOptionDescription,
};
