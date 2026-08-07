'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
    STRIKE_GATE_THRESHOLD,
    HEALTH,
    deriveHealthStatus,
    activeStrikeGate,
    appealEligibility,
} = require('../utils/league_enforcement');

test('deriveHealthStatus maps strike count to health tier', () => {
    assert.strictEqual(deriveHealthStatus(0), HEALTH.HEALTHY);
    assert.strictEqual(deriveHealthStatus(1), HEALTH.NEEDS_ATTENTION);
    assert.strictEqual(deriveHealthStatus(STRIKE_GATE_THRESHOLD - 1), HEALTH.NEEDS_ATTENTION);
    assert.strictEqual(deriveHealthStatus(STRIKE_GATE_THRESHOLD), HEALTH.AT_RISK);
    assert.strictEqual(deriveHealthStatus(10), HEALTH.AT_RISK);
});

test('activeStrikeGate blocks at or above the threshold', () => {
    assert.strictEqual(activeStrikeGate(0).ok, true);
    assert.strictEqual(activeStrikeGate(STRIKE_GATE_THRESHOLD - 1).ok, true);
    const blocked = activeStrikeGate(STRIKE_GATE_THRESHOLD);
    assert.strictEqual(blocked.ok, false);
    assert.strictEqual(blocked.code, 'STRIKES');
});

test('appealEligibility requires an active, un-appealed strike', () => {
    assert.strictEqual(appealEligibility({ active: true }, { hasPendingAppeal: false }).ok, true);
    assert.strictEqual(appealEligibility(null).code, 'NO_STRIKE');
    assert.strictEqual(appealEligibility({ active: false }).code, 'STRIKE_RESOLVED');
    assert.strictEqual(appealEligibility({ active: true }, { hasPendingAppeal: true }).code, 'APPEAL_EXISTS');
});

// --- Active League promotion requirements ---

const { evaluateActiveLeagueRequirements, ACTIVE_LEAGUE_REQUIREMENTS } = require('../utils/league_enforcement');

const failedCodes = (result) => result.checks.filter(c => !c.ok).map(c => c.code);

const passing = () => ({
    memberCount: 120,
    approvalDate: '2026-06-01',
    lastCheckinDate: '2026-07-20',
    checkinMonths: ['2026-06', '2026-07'],
    activeStrikes: 0,
    healthStatus: 'Healthy',
    now: new Date('2026-08-01T00:00:00Z'),
});

test('evaluateActiveLeagueRequirements passes a qualifying league', () => {
    const result = evaluateActiveLeagueRequirements(passing());
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(failedCodes(result), []);
    assert.strictEqual(result.checks.length, 4);
});

test('members: below minimum or unverifiable fails', () => {
    assert.deepStrictEqual(
        failedCodes(evaluateActiveLeagueRequirements({ ...passing(), memberCount: ACTIVE_LEAGUE_REQUIREMENTS.MIN_MEMBERS - 1 })),
        ['MEMBERS']
    );
    assert.deepStrictEqual(failedCodes(evaluateActiveLeagueRequirements({ ...passing(), memberCount: null })), ['MEMBERS']);
});

test('tenure: leagues younger than 30 days fail', () => {
    const result = evaluateActiveLeagueRequirements({ ...passing(), approvalDate: '2026-07-15' });
    assert.deepStrictEqual(failedCodes(result), ['TENURE']);
    assert.deepStrictEqual(failedCodes(evaluateActiveLeagueRequirements({ ...passing(), approvalDate: null })), ['TENURE']);
});

test('checkins: stale last check-in fails', () => {
    const result = evaluateActiveLeagueRequirements({ ...passing(), lastCheckinDate: '2026-06-20' });
    assert.deepStrictEqual(failedCodes(result), ['CHECKINS']);
    assert.deepStrictEqual(failedCodes(evaluateActiveLeagueRequirements({ ...passing(), lastCheckinDate: null })), ['CHECKINS']);
});

test('checkins: months must include a recent consecutive run', () => {
    const gap = evaluateActiveLeagueRequirements({ ...passing(), checkinMonths: ['2026-05', '2026-07'] });
    assert.deepStrictEqual(failedCodes(gap), ['CHECKINS']);
    const single = evaluateActiveLeagueRequirements({ ...passing(), checkinMonths: ['2026-07'] });
    assert.deepStrictEqual(failedCodes(single), ['CHECKINS']);
});

test('checkins: streak spanning a year boundary counts when recent', () => {
    const result = evaluateActiveLeagueRequirements({
        ...passing(),
        approvalDate: '2025-11-01',
        lastCheckinDate: '2026-01-20',
        checkinMonths: ['2025-12', '2026-01'],
        now: new Date('2026-02-01T00:00:00Z'),
    });
    assert.deepStrictEqual(failedCodes(result), []);
});

test('checkins: a stale historical streak does not qualify', () => {
    const result = evaluateActiveLeagueRequirements({
        ...passing(),
        lastCheckinDate: '2026-07-25',
        checkinMonths: ['2026-01', '2026-02', '2026-07'],
        now: new Date('2026-08-01T00:00:00Z'),
    });
    assert.deepStrictEqual(failedCodes(result), ['CHECKINS']);
});

test('standing: strikes or poor health fail', () => {
    assert.deepStrictEqual(failedCodes(evaluateActiveLeagueRequirements({ ...passing(), activeStrikes: 1 })), ['STANDING']);
    assert.deepStrictEqual(failedCodes(evaluateActiveLeagueRequirements({ ...passing(), healthStatus: 'At Risk' })), ['STANDING']);
});

test('multiple failures are all reported', () => {
    const result = evaluateActiveLeagueRequirements({
        ...passing(), memberCount: 10, activeStrikes: 2,
    });
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(failedCodes(result), ['MEMBERS', 'STANDING']);
});

// --- Active League retention (the lower keep-bar) ---

const { evaluateActiveLeagueRetention, ACTIVE_LEAGUE_RETENTION } = require('../utils/league_enforcement');

const retained = () => ({
    memberCount: 60,
    lastCheckinDate: '2026-07-20',
    activeStrikes: 0,
    now: new Date('2026-08-01T00:00:00Z'),
});

test('retention passes a healthy Active league', () => {
    const result = evaluateActiveLeagueRetention(retained());
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.checks.length, 3);
});

test('retention bar sits below the entry bar', () => {
    assert.ok(ACTIVE_LEAGUE_RETENTION.MIN_MEMBERS < 50, 'keep-bar must be below entry to prevent flapping');
    const atKeepBar = evaluateActiveLeagueRetention({ ...retained(), memberCount: ACTIVE_LEAGUE_RETENTION.MIN_MEMBERS });
    assert.strictEqual(atKeepBar.ok, true);
    const below = evaluateActiveLeagueRetention({ ...retained(), memberCount: ACTIVE_LEAGUE_RETENTION.MIN_MEMBERS - 1 });
    assert.deepStrictEqual(failedCodes(below), ['MEMBERS']);
});

test('retention gives benefit of the doubt on unverifiable member counts', () => {
    const result = evaluateActiveLeagueRetention({ ...retained(), memberCount: null });
    assert.strictEqual(result.ok, true);
});

test('retention fails on lapsed check-ins or 2+ strikes', () => {
    assert.deepStrictEqual(failedCodes(evaluateActiveLeagueRetention({ ...retained(), lastCheckinDate: '2026-06-01' })), ['CHECKINS']);
    assert.deepStrictEqual(failedCodes(evaluateActiveLeagueRetention({ ...retained(), lastCheckinDate: null })), ['CHECKINS']);
    assert.deepStrictEqual(failedCodes(evaluateActiveLeagueRetention({ ...retained(), activeStrikes: 2 })), ['STRIKES']);
    assert.strictEqual(evaluateActiveLeagueRetention({ ...retained(), activeStrikes: 1 }).ok, true);
});
