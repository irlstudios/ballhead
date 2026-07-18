'use strict';

// Pure logic for league reward requests (Phase 5). Reward approval and
// fulfillment stay manual (staff approve; a human with backend access fulfils).
// This module only gates intake.

const { activeStrikeGate } = require('./league_enforcement');

// A Sponsored league may submit at most this many reward requests per month.
const REWARD_MONTHLY_CAP = 2;

const REWARD_STATUS = Object.freeze({ PENDING: 'Pending', APPROVED: 'Approved', DENIED: 'Denied', FULFILLED: 'Fulfilled' });
const FULFILLMENT = Object.freeze({ NONE: 'None', AWAITING: 'Awaiting Fulfillment', DONE: 'Fulfilled' });

function deny(code, title, message) {
    return Object.freeze({ ok: false, code, title, message });
}
const ALLOW = Object.freeze({ ok: true, code: 'OK', title: null, message: null });

// Reward requests are Sponsored-only, require an active league, are blocked by
// too many strikes, and are capped per month.
function rewardRequestEligibility(league, { activeStrikes = 0, monthCount = 0 } = {}) {
    if (!league) {
        return deny('NO_LEAGUE', 'No League Found', 'You do not own or co-own a registered league.');
    }
    if (league.league_type !== 'Sponsored') {
        return deny('NOT_SPONSORED', 'Sponsored Only', 'Only Sponsored leagues can request rewards.');
    }
    if (league.league_status !== 'Active') {
        return deny('NOT_ACTIVE', 'League Not Active', 'Your league must be Active to request rewards.');
    }
    const strikeGate = activeStrikeGate(activeStrikes);
    if (!strikeGate.ok) {
        return strikeGate;
    }
    if ((Number(monthCount) || 0) >= REWARD_MONTHLY_CAP) {
        return deny(
            'CAP',
            'Monthly Cap Reached',
            `Your league has already submitted ${monthCount} reward requests this month (max ${REWARD_MONTHLY_CAP}).`
        );
    }
    return ALLOW;
}

module.exports = {
    REWARD_MONTHLY_CAP,
    REWARD_STATUS,
    FULFILLMENT,
    rewardRequestEligibility,
};
