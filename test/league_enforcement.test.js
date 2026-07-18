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
