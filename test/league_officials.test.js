'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
    MAX_OPEN_REQUESTS_PER_LEAGUE,
    REQUEST_STATUS,
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

// --- canApproveOfficialRequest ------------------------------------------------

const gcGuildId = 'gc-guild';
const cdRoleId = 'cd-role';
const gcCfg = Object.freeze({ gcGuildId, cdRoleId });

test('allows a Community Director acting in the Gym Class guild', () => {
    const memberRoleIds = new Set([cdRoleId, 'other-role']);
    assert.strictEqual(canApproveOfficialRequest({ guildId: gcGuildId, memberRoleIds }, gcCfg), true);
});

test('blocks the right guild without the Community Director role', () => {
    const memberRoleIds = new Set(['some-other-role']);
    assert.strictEqual(canApproveOfficialRequest({ guildId: gcGuildId, memberRoleIds }, gcCfg), false);
});

test('blocks the Community Director role held in the wrong guild', () => {
    const memberRoleIds = new Set([cdRoleId]);
    assert.strictEqual(canApproveOfficialRequest({ guildId: 'some-other-guild', memberRoleIds }, gcCfg), false);
});

test('blocks a missing member or roles collection', () => {
    assert.strictEqual(canApproveOfficialRequest({ guildId: gcGuildId, memberRoleIds: undefined }, gcCfg), false);
    assert.strictEqual(canApproveOfficialRequest({ guildId: gcGuildId, memberRoleIds: null }, gcCfg), false);
    assert.strictEqual(canApproveOfficialRequest({ guildId: gcGuildId }, gcCfg), false);
    assert.strictEqual(canApproveOfficialRequest({}, gcCfg), false);
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

// --- shortAgo -----------------------------------------------------------------

test('shortAgo buckets under a day as "today"', () => {
    const now = Date.UTC(2026, 0, 10);
    assert.strictEqual(shortAgo(now, now), 'today');
    assert.strictEqual(shortAgo(now - 3 * 60 * 60 * 1000, now), 'today');
});

test('shortAgo buckets days and weeks', () => {
    const now = Date.UTC(2026, 0, 10);
    const DAY = 24 * 60 * 60 * 1000;
    assert.strictEqual(shortAgo(now - 3 * DAY, now), '3d');
    assert.strictEqual(shortAgo(now - 6 * DAY, now), '6d');
    assert.strictEqual(shortAgo(now - 14 * DAY, now), '2w');
    assert.strictEqual(shortAgo(now - 29 * DAY, now), '4w');
});

test('shortAgo buckets months', () => {
    const now = Date.UTC(2026, 0, 10);
    const DAY = 24 * 60 * 60 * 1000;
    assert.strictEqual(shortAgo(now - 30 * DAY, now), '1mo');
    assert.strictEqual(shortAgo(now - 150 * DAY, now), '5mo');
});

// --- canCancelOfficialRequest ------------------------------------------------

const cancellableRequest = Object.freeze({
    id: 4,
    status: REQUEST_STATUS.PENDING,
    requested_by: 'requester-1',
});

test('lets the original requester cancel a still-pending request', () => {
    assert.strictEqual(canCancelOfficialRequest(cancellableRequest, 'requester-1').ok, true);
    // tolerates id type mismatch (BIGINT vs text)
    assert.strictEqual(canCancelOfficialRequest({ ...cancellableRequest, requested_by: 123 }, '123').ok, true);
});

test('blocks anyone but the original requester from cancelling', () => {
    const r = canCancelOfficialRequest(cancellableRequest, 'someone-else');
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, 'NOT_REQUESTER');
});

test('blocks cancelling once the request is no longer pending', () => {
    for (const status of [REQUEST_STATUS.ASSIGNED, REQUEST_STATUS.COMPLETED, REQUEST_STATUS.DENIED]) {
        const r = canCancelOfficialRequest({ ...cancellableRequest, status }, 'requester-1');
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.code, 'NOT_PENDING');
    }
});

test('blocks cancelling a missing request', () => {
    const r = canCancelOfficialRequest(null, 'requester-1');
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, 'NO_REQUEST');
});

// --- officialOptionDescription ------------------------------------------------

test('official with no track record shows as new (fetch succeeded, genuinely zero games)', () => {
    assert.strictEqual(officialOptionDescription({ sport: 'Soccer' }, undefined), 'new');
});

test('official with zero games shows as new even if a record row exists', () => {
    assert.strictEqual(officialOptionDescription({ sport: 'Soccer' }, { games: 0 }), 'new');
});

test('null trackRecord (aggregate fetch failed) degrades to the plain pre-enrichment description, not "new"', () => {
    assert.strictEqual(officialOptionDescription({ sport: 'Soccer' }, null), 'Sport: Soccer');
});

test('null trackRecord still falls back to "Any" and truncates like the normal path', () => {
    assert.strictEqual(officialOptionDescription({}, null), 'Sport: Any');
    const longSport = 'Extremely Long Sport Name '.repeat(10);
    assert.strictEqual(officialOptionDescription({ sport: longSport }, null).length, 100);
});

test('official with one game reports sport, count, and recency', () => {
    const now = Date.UTC(2026, 0, 10);
    const DAY = 24 * 60 * 60 * 1000;
    const desc = officialOptionDescription({ sport: 'Soccer' }, { games: 1, last_active: now - 3 * DAY }, now);
    assert.strictEqual(desc, 'Sport: Soccer · 1 games · last 3d');
});

test('official with many games reports the total', () => {
    const now = Date.UTC(2026, 0, 10);
    const DAY = 24 * 60 * 60 * 1000;
    const desc = officialOptionDescription({ sport: 'Basketball' }, { games: 42, last_active: now - DAY / 2 }, now);
    assert.strictEqual(desc, 'Sport: Basketball · 42 games · last today');
});

test('stale last-active reads in months, recent reads in days', () => {
    const now = Date.UTC(2026, 0, 10);
    const DAY = 24 * 60 * 60 * 1000;
    const stale = officialOptionDescription({ sport: 'Soccer' }, { games: 5, last_active: now - 150 * DAY }, now);
    assert.ok(stale.includes('last 5mo'), stale);
    const recent = officialOptionDescription({ sport: 'Soccer' }, { games: 5, last_active: now - DAY / 2 }, now);
    assert.ok(recent.includes('last today'), recent);
});

test('falls back to "Any" when the roster row has no sport', () => {
    const now = Date.UTC(2026, 0, 10);
    const desc = officialOptionDescription({}, { games: 2, last_active: now }, now);
    assert.ok(desc.startsWith('Sport: Any ·'), desc);
});

test('description is truncated to Discord\'s 100-char option-description cap', () => {
    const now = Date.UTC(2026, 0, 10);
    const longSport = 'Extremely Long Sport Name '.repeat(10);
    const desc = officialOptionDescription({ sport: longSport }, { games: 3, last_active: now }, now);
    assert.strictEqual(desc.length, 100);
});
