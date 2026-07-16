'use strict';

const { URL } = require('node:url');
const {
    OFFICIAL_SENIOR_ROLE_ID,
    OFFICIAL_ACTIVE_ROLE_ID,
    OFFICIAL_PROSPECT_ROLE_ID,
} = require('../config/constants');

// Tiers permitted to request officials. Base leagues are directory-only.
const OFFICIAL_REQUEST_TIERS = ['Active', 'Sponsored'];

// A game counts toward a league's "games played" metric only once a human
// with authority has verified it. Self-reported games are shown separately.
const VERIFIED_STATUSES = ['Official Verified', 'Staff Verified'];

const isVerifiedStatus = (status) => VERIFIED_STATUSES.includes(status);

// Sponsored leagues get priority official support; Active is normal priority.
const requestPriority = (leagueType) =>
    (leagueType === 'Sponsored' ? 'Priority' : 'Normal');

// Gate for /request-official. Returns { ok, reason }. Requester ownership is
// checked separately against the DB; this covers only tier + status.
const officialRequestEligibility = ({ leagueType, leagueStatus } = {}) => {
    if (leagueStatus !== 'Active') {
        return { ok: false, reason: 'Your league must be Active (not inactive or disbanded) to request officials.' };
    }
    if (!OFFICIAL_REQUEST_TIERS.includes(leagueType)) {
        return { ok: false, reason: 'Only Active and Sponsored leagues can request officials. Base leagues are directory-only.' };
    }
    return { ok: true, reason: null };
};

// Map a roster member's Discord roles to their officials-program tier.
// Highest tier wins. Returns null for a non-official.
const resolveOfficialTier = (roleIds) => {
    const has = (id) => (roleIds && typeof roleIds.has === 'function' ? roleIds.has(id) : Array.isArray(roleIds) && roleIds.includes(id));
    if (has(OFFICIAL_SENIOR_ROLE_ID)) return 'Senior';
    if (has(OFFICIAL_ACTIVE_ROLE_ID)) return 'Active';
    if (has(OFFICIAL_PROSPECT_ROLE_ID)) return 'Prospect';
    return null;
};

// Spread up to three selected official ids across the request's assignment slots.
const mapAssignedOfficials = (selectedIds = []) => ({
    one: selectedIds[0] ?? null,
    two: selectedIds[1] ?? null,
    three: selectedIds[2] ?? null,
});

// The assigned officials on a request, as string ids (pg returns BIGINT as text).
const assignedOfficialIds = (request = {}) =>
    [request.assigned_official_1, request.assigned_official_2, request.assigned_official_3]
        .filter(Boolean)
        .map((id) => id.toString());

// Whether userId may submit a report: must be an assigned official AND the
// request must still be open for a report (status 'Assigned'). Re-checked at
// both the button press and the modal submit.
const canSubmitReport = (request, userId) => {
    if (!request) return { ok: false, reason: 'Request not found.' };
    if (!assignedOfficialIds(request).includes(userId.toString())) {
        return { ok: false, reason: 'You are not an assigned official for this request.' };
    }
    if (request.status !== 'Assigned') {
        return { ok: false, reason: `This request is ${String(request.status).toLowerCase()} and no longer accepts a report.` };
    }
    return { ok: true, reason: null };
};

// Proof links must be real http(s) URLs. Rejects free text and other schemes.
const isValidHttpUrl = (value) => {
    if (!value || typeof value !== 'string') return false;
    try {
        const url = new URL(value.trim());
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
};

// Build the immutable league_games row from an accepted official report.
// completed_at is set in SQL (NOW()); team_1/team_2/host are not collected in V1.
const buildVerifiedGameRecord = ({ request, report, officialId, reviewedBy = null } = {}) => ({
    league_id: request.league_id,
    request_id: request.request_id,
    sport: request.sport ?? null,
    game_type: request.game_mode ?? null,
    scheduled_at: request.scheduled_at ?? null,
    final_score: report.final_score ?? null,
    winning_team: report.winning_team ?? null,
    player_count: Number.isInteger(report.player_count) ? report.player_count : null,
    official_id: officialId,
    verification_status: 'Official Verified',
    verification_method: 'official-report',
    proof_url: report.proof_url ?? null,
    reported_by: officialId,
    reviewed_by: reviewedBy,
    notes: report.sportsmanship_notes ?? null,
});

module.exports = {
    OFFICIAL_REQUEST_TIERS,
    VERIFIED_STATUSES,
    isVerifiedStatus,
    requestPriority,
    officialRequestEligibility,
    resolveOfficialTier,
    mapAssignedOfficials,
    assignedOfficialIds,
    canSubmitReport,
    isValidHttpUrl,
    buildVerifiedGameRecord,
};
