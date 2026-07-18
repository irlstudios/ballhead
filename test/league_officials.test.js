'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
    MAX_OPEN_REQUESTS_PER_LEAGUE,
    REQUEST_STATUS,
    isValidHttpUrl,
    officialRequestEligibility,
    atOpenRequestCap,
    canSubmitReport,
    officialMatchesSport,
    buildRequestCardLines,
    buildGamesSummaryLine,
} = require('../utils/league_officials');

const activeLeague = Object.freeze({
    league_id: 7,
    league_name: 'Sky Ballers',
    league_type: 'Active',
    league_status: 'Active',
});

// --- isValidHttpUrl ----------------------------------------------------------

test('accepts http and https urls', () => {
    assert.strictEqual(isValidHttpUrl('https://youtu.be/abc'), true);
    assert.strictEqual(isValidHttpUrl('http://example.com/clip'), true);
    assert.strictEqual(isValidHttpUrl('  https://trimmed.example  '), true);
});

test('rejects non-http, malformed, and empty urls', () => {
    assert.strictEqual(isValidHttpUrl('not a url'), false);
    assert.strictEqual(isValidHttpUrl('ftp://example.com'), false);
    assert.strictEqual(isValidHttpUrl('javascript:alert(1)'), false);
    assert.strictEqual(isValidHttpUrl(''), false);
    assert.strictEqual(isValidHttpUrl(null), false);
    assert.strictEqual(isValidHttpUrl(undefined), false);
});

// --- officialRequestEligibility ---------------------------------------------

test('allows an active, checked-in Active/Sponsored league', () => {
    assert.strictEqual(officialRequestEligibility(activeLeague, { hasCurrentCheckin: true }).ok, true);
    const sponsored = { ...activeLeague, league_type: 'Sponsored' };
    assert.strictEqual(officialRequestEligibility(sponsored, { hasCurrentCheckin: true }).ok, true);
});

test('blocks when the caller has no league', () => {
    const r = officialRequestEligibility(null, { hasCurrentCheckin: true });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, 'NO_LEAGUE');
});

test('blocks Base leagues as directory-only', () => {
    const r = officialRequestEligibility({ ...activeLeague, league_type: 'Base' }, { hasCurrentCheckin: true });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, 'BASE_TIER');
});

test('blocks a non-Active status', () => {
    const r = officialRequestEligibility({ ...activeLeague, league_status: 'Inactive' }, { hasCurrentCheckin: true });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, 'NOT_ACTIVE');
});

test('blocks when this month has no check-in (confirmed policy)', () => {
    const r = officialRequestEligibility(activeLeague, { hasCurrentCheckin: false });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, 'NO_CHECKIN');
});

test('check-in gate defaults to required when omitted', () => {
    const r = officialRequestEligibility(activeLeague);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, 'NO_CHECKIN');
});

// --- atOpenRequestCap --------------------------------------------------------

test('caps open requests at the max', () => {
    assert.strictEqual(atOpenRequestCap(0), false);
    assert.strictEqual(atOpenRequestCap(MAX_OPEN_REQUESTS_PER_LEAGUE - 1), false);
    assert.strictEqual(atOpenRequestCap(MAX_OPEN_REQUESTS_PER_LEAGUE), true);
    assert.strictEqual(atOpenRequestCap(MAX_OPEN_REQUESTS_PER_LEAGUE + 3), true);
});

// --- canSubmitReport ---------------------------------------------------------

const assignedRequest = Object.freeze({
    id: 1,
    status: REQUEST_STATUS.ASSIGNED,
    assigned_official_id: 'off-1',
});

test('lets the assigned official submit a report', () => {
    assert.strictEqual(canSubmitReport(assignedRequest, 'off-1').ok, true);
    // tolerates id type mismatch (BIGINT vs text)
    assert.strictEqual(canSubmitReport({ ...assignedRequest, assigned_official_id: 123 }, '123').ok, true);
});

test('blocks a non-assigned user from reporting', () => {
    const r = canSubmitReport(assignedRequest, 'someone-else');
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, 'NOT_ASSIGNED');
});

test('blocks reporting on a non-assigned (pending/completed/denied) request', () => {
    assert.strictEqual(canSubmitReport({ ...assignedRequest, status: 'Pending' }, 'off-1').code, 'NOT_OPEN');
    assert.strictEqual(canSubmitReport({ ...assignedRequest, status: 'Completed' }, 'off-1').code, 'NOT_OPEN');
    assert.strictEqual(canSubmitReport(null, 'off-1').code, 'NO_REQUEST');
});

// --- officialMatchesSport ----------------------------------------------------

test('matches "Any" or empty roster sport to any request', () => {
    assert.strictEqual(officialMatchesSport('Any', 'Soccer'), true);
    assert.strictEqual(officialMatchesSport('', 'Soccer'), true);
    assert.strictEqual(officialMatchesSport(null, 'Basketball'), true);
});

test('matches a specific sport case-insensitively, rejects mismatches', () => {
    assert.strictEqual(officialMatchesSport('Soccer', 'soccer'), true);
    assert.strictEqual(officialMatchesSport('Soccer', 'Basketball'), false);
});

// --- formatters --------------------------------------------------------------

test('request card lines include identity and status, plus assignment when set', () => {
    const lines = buildRequestCardLines(
        { requested_by: 'owner-1', sport: 'Soccer', match_details: 'vs Rivals', proposed_time: 'Sat 8pm', status: 'Pending' },
        { leagueName: 'Sky Ballers' }
    );
    assert.ok(lines.some((l) => l.includes('Sky Ballers')));
    assert.ok(lines.some((l) => l.includes('<@owner-1>')));
    assert.ok(lines.some((l) => l.includes('Pending')));

    const assigned = buildRequestCardLines(
        { requested_by: 'owner-1', sport: 'Soccer', status: 'Assigned', assigned_official_id: 'off-9' },
        { leagueName: 'Sky Ballers' }
    );
    assert.ok(assigned.some((l) => l.includes('<@off-9>')));
});

test('games summary line reports verified and total counts', () => {
    assert.strictEqual(buildGamesSummaryLine({ verified: 3, reported: 5 }), 'Verified games: **3** | Total reported: **5**');
    assert.strictEqual(buildGamesSummaryLine(), 'Verified games: **0** | Total reported: **0**');
});
