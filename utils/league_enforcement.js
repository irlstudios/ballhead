'use strict';

// Pure logic for league enforcement (Phase 4): strike gating, health derivation,
// and appeal eligibility. Strike decisions and appeal outcomes stay manual
// (staff); this module only enforces the mechanical rules around them.

// Active strikes at or above this block upgrades and reward requests until
// resolved or appealed.
const STRIKE_GATE_THRESHOLD = 3;

const HEALTH = Object.freeze({ HEALTHY: 'Healthy', NEEDS_ATTENTION: 'Needs Attention', AT_RISK: 'At Risk' });
const APPEAL_STATUS = Object.freeze({ PENDING: 'Pending', ACCEPTED: 'Accepted', REJECTED: 'Rejected' });

function deny(code, title, message) {
    return Object.freeze({ ok: false, code, title, message });
}
const ALLOW = Object.freeze({ ok: true, code: 'OK', title: null, message: null });

// Internal health status derived from active strike count. Kept pure so it can
// be recomputed anywhere (strike add/resolve) and unit-tested.
function deriveHealthStatus(activeStrikes) {
    const n = Number(activeStrikes) || 0;
    if (n >= STRIKE_GATE_THRESHOLD) {
        return HEALTH.AT_RISK;
    }
    if (n > 0) {
        return HEALTH.NEEDS_ATTENTION;
    }
    return HEALTH.HEALTHY;
}

// Gate for tier upgrades and reward requests: too many active strikes blocks.
function activeStrikeGate(activeCount) {
    const n = Number(activeCount) || 0;
    if (n >= STRIKE_GATE_THRESHOLD) {
        return deny(
            'STRIKES',
            'Blocked by Strikes',
            `Your league has ${n} active strikes and cannot upgrade or request rewards until they are resolved or appealed.`
        );
    }
    return ALLOW;
}

// A league may appeal only an active strike, and only once at a time.
function appealEligibility(strike, { hasPendingAppeal = false } = {}) {
    if (!strike) {
        return deny('NO_STRIKE', 'Strike Not Found', 'No strike with that id belongs to your league.');
    }
    if (!strike.active) {
        return deny('STRIKE_RESOLVED', 'Already Resolved', 'This strike is no longer active, so it cannot be appealed.');
    }
    if (hasPendingAppeal) {
        return deny('APPEAL_EXISTS', 'Appeal Pending', 'An appeal for this strike is already awaiting review.');
    }
    return ALLOW;
}

module.exports = {
    STRIKE_GATE_THRESHOLD,
    HEALTH,
    APPEAL_STATUS,
    deriveHealthStatus,
    activeStrikeGate,
    appealEligibility,
};
