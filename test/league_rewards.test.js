'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { REWARD_MONTHLY_CAP, rewardRequestEligibility } = require('../utils/league_rewards');
const { STRIKE_GATE_THRESHOLD } = require('../utils/league_enforcement');

const sponsored = Object.freeze({ league_type: 'Sponsored', league_status: 'Active' });

test('allows a clean sponsored league under the cap', () => {
    assert.strictEqual(rewardRequestEligibility(sponsored, { activeStrikes: 0, monthCount: 0 }).ok, true);
    assert.strictEqual(rewardRequestEligibility(sponsored, { activeStrikes: 1, monthCount: REWARD_MONTHLY_CAP - 1 }).ok, true);
});

test('blocks non-sponsored, inactive, and missing leagues', () => {
    assert.strictEqual(rewardRequestEligibility(null).code, 'NO_LEAGUE');
    assert.strictEqual(rewardRequestEligibility({ league_type: 'Active', league_status: 'Active' }).code, 'NOT_SPONSORED');
    assert.strictEqual(rewardRequestEligibility({ ...sponsored, league_status: 'Inactive' }).code, 'NOT_ACTIVE');
});

test('blocks when strikes gate is tripped', () => {
    const r = rewardRequestEligibility(sponsored, { activeStrikes: STRIKE_GATE_THRESHOLD, monthCount: 0 });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, 'STRIKES');
});

test('blocks when the monthly cap is reached', () => {
    const r = rewardRequestEligibility(sponsored, { activeStrikes: 0, monthCount: REWARD_MONTHLY_CAP });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, 'CAP');
});
