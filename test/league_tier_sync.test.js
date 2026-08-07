'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { decideTierMoves } = require('../utils/league_tier_sync');

const NOW = new Date('2026-08-01T00:00:00Z');

const baseLeague = (overrides = {}) => ({
    league_id: 1,
    league_name: 'Test League',
    league_type: 'Base',
    member_count: 120,
    approval_date: '2026-06-01',
    last_checkin_date: '2026-07-20',
    last_health_check: '2026-07-28',
    checkin_months: ['2026-06', '2026-07'],
    active_strikes: 0,
    health_status: 'Healthy',
    ...overrides,
});

test('a Base league meeting entry requirements is promoted', () => {
    const { promotions, demotions } = decideTierMoves([baseLeague()], NOW);
    assert.strictEqual(promotions.length, 1);
    assert.strictEqual(demotions.length, 0);
    assert.strictEqual(promotions[0].league.league_id, 1);
});

test('a Base league short of the entry bar stays put', () => {
    const { promotions, demotions } = decideTierMoves([baseLeague({ member_count: 30 })], NOW);
    assert.strictEqual(promotions.length, 0);
    assert.strictEqual(demotions.length, 0);
});

test('an Active league failing retention is demoted with its failed checks', () => {
    const league = baseLeague({ league_type: 'Active', member_count: 20 });
    const { promotions, demotions } = decideTierMoves([league], NOW);
    assert.strictEqual(promotions.length, 0);
    assert.strictEqual(demotions.length, 1);
    assert.ok(demotions[0].checks.some(c => c.code === 'MEMBERS' && !c.ok));
});

test('an Active league inside the keep-bar is untouched even below the entry bar', () => {
    // 45 members: below the 50 entry bar but above the 40 keep-bar -- no flap.
    const league = baseLeague({ league_type: 'Active', member_count: 45 });
    const { promotions, demotions } = decideTierMoves([league], NOW);
    assert.strictEqual(promotions.length + demotions.length, 0);
});

test('Sponsored leagues are never auto-moved', () => {
    const league = baseLeague({ league_type: 'Sponsored', member_count: 1 });
    const { promotions, demotions } = decideTierMoves([league], NOW);
    assert.strictEqual(promotions.length + demotions.length, 0);
});

// A member count only counts when the health check that produced it is
// recent. Stale counts must never promote, and must never demote either.
test('a stale health check blocks promotion', () => {
    const league = baseLeague({ last_health_check: '2026-06-01' });
    const { promotions } = decideTierMoves([league], NOW);
    assert.strictEqual(promotions.length, 0);
    const never = baseLeague({ last_health_check: null });
    assert.strictEqual(decideTierMoves([never], NOW).promotions.length, 0);
});

test('a stale health check never demotes on member count', () => {
    const league = baseLeague({ league_type: 'Active', member_count: 5, last_health_check: '2026-06-01' });
    const { demotions } = decideTierMoves([league], NOW);
    assert.strictEqual(demotions.length, 0);
});
