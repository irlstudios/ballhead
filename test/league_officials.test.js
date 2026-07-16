'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
    isVerifiedStatus,
    requestPriority,
    officialRequestEligibility,
    resolveOfficialTier,
    mapAssignedOfficials,
    assignedOfficialIds,
    canSubmitReport,
    isValidHttpUrl,
    buildVerifiedGameRecord,
} = require('../utils/league_officials');
const {
    OFFICIAL_SENIOR_ROLE_ID,
    OFFICIAL_ACTIVE_ROLE_ID,
    OFFICIAL_PROSPECT_ROLE_ID,
} = require('../config/constants');

// --- isVerifiedStatus --------------------------------------------------------

test('only official/staff verified statuses count as verified', () => {
    assert.strictEqual(isVerifiedStatus('Official Verified'), true);
    assert.strictEqual(isVerifiedStatus('Staff Verified'), true);
    assert.strictEqual(isVerifiedStatus('Self Reported'), false);
    assert.strictEqual(isVerifiedStatus('Rejected'), false);
    assert.strictEqual(isVerifiedStatus(undefined), false);
});

// --- requestPriority ---------------------------------------------------------

test('sponsored leagues get priority, others normal', () => {
    assert.strictEqual(requestPriority('Sponsored'), 'Priority');
    assert.strictEqual(requestPriority('Active'), 'Normal');
    assert.strictEqual(requestPriority('Base'), 'Normal');
});

// --- officialRequestEligibility ---------------------------------------------

test('active and sponsored active leagues may request officials', () => {
    assert.strictEqual(officialRequestEligibility({ leagueType: 'Active', leagueStatus: 'Active' }).ok, true);
    assert.strictEqual(officialRequestEligibility({ leagueType: 'Sponsored', leagueStatus: 'Active' }).ok, true);
});

test('base leagues cannot request officials', () => {
    const result = officialRequestEligibility({ leagueType: 'Base', leagueStatus: 'Active' });
    assert.strictEqual(result.ok, false);
    assert.match(result.reason, /Base leagues/);
});

test('inactive or disbanded leagues cannot request officials', () => {
    assert.strictEqual(officialRequestEligibility({ leagueType: 'Active', leagueStatus: 'Inactive' }).ok, false);
    assert.strictEqual(officialRequestEligibility({ leagueType: 'Sponsored', leagueStatus: 'Disbanded' }).ok, false);
});

// --- resolveOfficialTier -----------------------------------------------------

test('resolves the highest official tier a member holds', () => {
    assert.strictEqual(resolveOfficialTier(new Set([OFFICIAL_SENIOR_ROLE_ID, OFFICIAL_ACTIVE_ROLE_ID])), 'Senior');
    assert.strictEqual(resolveOfficialTier(new Set([OFFICIAL_ACTIVE_ROLE_ID])), 'Active');
    assert.strictEqual(resolveOfficialTier([OFFICIAL_PROSPECT_ROLE_ID]), 'Prospect');
});

test('returns null when member holds no official role', () => {
    assert.strictEqual(resolveOfficialTier(new Set(['some-other-role'])), null);
    assert.strictEqual(resolveOfficialTier([]), null);
    assert.strictEqual(resolveOfficialTier(undefined), null);
});

// --- mapAssignedOfficials ----------------------------------------------------

test('spreads selected officials across three slots', () => {
    assert.deepStrictEqual(mapAssignedOfficials(['a', 'b', 'c']), { one: 'a', two: 'b', three: 'c' });
    assert.deepStrictEqual(mapAssignedOfficials(['a']), { one: 'a', two: null, three: null });
    assert.deepStrictEqual(mapAssignedOfficials([]), { one: null, two: null, three: null });
});

// --- assignedOfficialIds -----------------------------------------------------

test('collects assigned official ids as strings, skipping empty slots', () => {
    assert.deepStrictEqual(
        assignedOfficialIds({ assigned_official_1: 111, assigned_official_2: null, assigned_official_3: 333 }),
        ['111', '333']
    );
    assert.deepStrictEqual(assignedOfficialIds({}), []);
});

// --- canSubmitReport ---------------------------------------------------------

const assignedReq = { status: 'Assigned', assigned_official_1: '111', assigned_official_2: null, assigned_official_3: null };

test('assigned official may submit while the request is Assigned', () => {
    assert.strictEqual(canSubmitReport(assignedReq, '111').ok, true);
});

test('non-assigned user may not submit', () => {
    const result = canSubmitReport(assignedReq, '999');
    assert.strictEqual(result.ok, false);
    assert.match(result.reason, /not an assigned official/);
});

test('a completed request rejects further reports (idempotency)', () => {
    const result = canSubmitReport({ ...assignedReq, status: 'Completed' }, '111');
    assert.strictEqual(result.ok, false);
    assert.match(result.reason, /completed/);
});

test('a denied request rejects reports', () => {
    assert.strictEqual(canSubmitReport({ ...assignedReq, status: 'Denied' }, '111').ok, false);
});

test('a missing request is rejected', () => {
    assert.strictEqual(canSubmitReport(null, '111').ok, false);
});

// --- isValidHttpUrl ----------------------------------------------------------

test('accepts http and https urls, rejects everything else', () => {
    assert.strictEqual(isValidHttpUrl('https://example.com/vod'), true);
    assert.strictEqual(isValidHttpUrl('http://example.com'), true);
    assert.strictEqual(isValidHttpUrl('  https://example.com  '), true);
    assert.strictEqual(isValidHttpUrl('example.com'), false);
    assert.strictEqual(isValidHttpUrl('ftp://example.com'), false);
    assert.strictEqual(isValidHttpUrl('javascript:alert(1)'), false);
    assert.strictEqual(isValidHttpUrl('not a url'), false);
    assert.strictEqual(isValidHttpUrl(''), false);
    assert.strictEqual(isValidHttpUrl(undefined), false);
});

// --- buildVerifiedGameRecord -------------------------------------------------

const request = {
    request_id: 7,
    league_id: 42,
    sport: 'Soccer',
    game_mode: '3v3',
    scheduled_at: 'Fri 8pm ET',
};
const report = {
    final_score: '3-2',
    winning_team: 'Sky Ballers',
    player_count: 6,
    proof_url: 'https://example.com/vod',
    sportsmanship_notes: 'Clean game',
};

test('builds an official-verified game record from a report', () => {
    const record = buildVerifiedGameRecord({ request, report, officialId: 'off-1', reviewedBy: 'staff-9' });
    assert.strictEqual(record.league_id, 42);
    assert.strictEqual(record.request_id, 7);
    assert.strictEqual(record.sport, 'Soccer');
    assert.strictEqual(record.game_type, '3v3');
    assert.strictEqual(record.final_score, '3-2');
    assert.strictEqual(record.winning_team, 'Sky Ballers');
    assert.strictEqual(record.player_count, 6);
    assert.strictEqual(record.official_id, 'off-1');
    assert.strictEqual(record.reported_by, 'off-1');
    assert.strictEqual(record.reviewed_by, 'staff-9');
    assert.strictEqual(record.verification_status, 'Official Verified');
    assert.strictEqual(record.verification_method, 'official-report');
    assert.strictEqual(record.proof_url, 'https://example.com/vod');
    assert.strictEqual(record.notes, 'Clean game');
});

test('coerces a non-integer player count to null', () => {
    const record = buildVerifiedGameRecord({ request, report: { ...report, player_count: 'lots' }, officialId: 'off-1' });
    assert.strictEqual(record.player_count, null);
});

test('defaults reviewed_by to null', () => {
    const record = buildVerifiedGameRecord({ request, report, officialId: 'off-1' });
    assert.strictEqual(record.reviewed_by, null);
});

test('does not mutate the input request or report', () => {
    const reqSnapshot = JSON.stringify(request);
    const repSnapshot = JSON.stringify(report);
    buildVerifiedGameRecord({ request, report, officialId: 'off-1' });
    assert.strictEqual(JSON.stringify(request), reqSnapshot);
    assert.strictEqual(JSON.stringify(report), repSnapshot);
});
