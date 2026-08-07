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

// Requirements to be promoted from Base to Active League. Thresholds drafted
// 2026-08 from the live distribution: median league is 33 members and 1.3
// months old; 15 of 79 leagues cleared this bar at draft time.
const ACTIVE_LEAGUE_REQUIREMENTS = Object.freeze({
    MIN_MEMBERS: 50,
    MIN_TENURE_DAYS: 30,
    MIN_CONSECUTIVE_CHECKIN_MONTHS: 2,
    CHECKIN_CURRENT_WINDOW_DAYS: 35,
});

const DAY_MS = 24 * 60 * 60 * 1000;

// Length of the run of adjacent 'YYYY-MM' months ending at the most recent
// check-in month, or 0 if that month is older than last month relative to
// `now`. A stale historical streak must not satisfy the requirement.
function recentConsecutiveMonths(months, now) {
    const indexes = [...new Set(
        (months || [])
            .map((m) => /^(\d{4})-(\d{2})$/.exec(m))
            .filter(Boolean)
            .map(([, y, mo]) => Number(y) * 12 + Number(mo) - 1)
    )].sort((a, b) => a - b);

    if (indexes.length === 0) {
        return 0;
    }
    const nowIndex = now.getUTCFullYear() * 12 + now.getUTCMonth();
    if (indexes[indexes.length - 1] < nowIndex - 1) {
        return 0;
    }
    let run = 1;
    for (let i = indexes.length - 1; i > 0 && indexes[i - 1] === indexes[i] - 1; i--) {
        run++;
    }
    return run;
}

function toTime(value) {
    if (!value) {
        return null;
    }
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? null : time;
}

// Pure evaluation of the Active League promotion requirements. Returns every
// check with its outcome so callers can show the full checklist, not just the
// first failure.
function evaluateActiveLeagueRequirements({
    memberCount,
    approvalDate,
    lastCheckinDate,
    checkinMonths,
    activeStrikes,
    healthStatus,
    now = new Date(),
} = {}) {
    const R = ACTIVE_LEAGUE_REQUIREMENTS;
    const nowTime = now.getTime();

    const members = Number.isFinite(memberCount) && memberCount >= R.MIN_MEMBERS;
    const approvalTime = toTime(approvalDate);
    const tenure = approvalTime !== null && nowTime - approvalTime >= R.MIN_TENURE_DAYS * DAY_MS;
    const lastCheckinTime = toTime(lastCheckinDate);
    const checkinCurrent = lastCheckinTime !== null
        && nowTime - lastCheckinTime <= R.CHECKIN_CURRENT_WINDOW_DAYS * DAY_MS;
    const checkins = checkinCurrent
        && recentConsecutiveMonths(checkinMonths, now) >= R.MIN_CONSECUTIVE_CHECKIN_MONTHS;
    const strikes = Number(activeStrikes) || 0;
    const standing = strikes === 0 && healthStatus === HEALTH.HEALTHY;

    const checks = Object.freeze([
        Object.freeze({
            code: 'MEMBERS',
            ok: members,
            label: `Server has at least ${R.MIN_MEMBERS} members`,
            detail: Number.isFinite(memberCount) ? `currently ${memberCount}` : 'could not be verified',
        }),
        Object.freeze({
            code: 'TENURE',
            ok: tenure,
            label: `League approved at least ${R.MIN_TENURE_DAYS} days ago`,
            detail: approvalTime !== null
                ? `approved ${Math.floor((nowTime - approvalTime) / DAY_MS)} days ago`
                : 'approval date missing',
        }),
        Object.freeze({
            code: 'CHECKINS',
            ok: checkins,
            label: `Checked in within the last ${R.CHECKIN_CURRENT_WINDOW_DAYS} days, with ${R.MIN_CONSECUTIVE_CHECKIN_MONTHS}+ consecutive monthly check-ins`,
            detail: checkinCurrent
                ? `current streak ${recentConsecutiveMonths(checkinMonths, now)} month(s)`
                : 'no recent check-in',
        }),
        Object.freeze({
            code: 'STANDING',
            ok: standing,
            label: 'No active strikes and league health is Healthy',
            detail: standing ? 'in good standing' : `${strikes} active strike(s), health ${healthStatus || 'unknown'}`,
        }),
    ]);

    return Object.freeze({ ok: checks.every((c) => c.ok), checks });
}

// Retention keep-bar for leagues already at Active tier. Deliberately below
// the entry requirements so a league hovering at a threshold does not flap
// between tiers on every daily sync.
const ACTIVE_LEAGUE_RETENTION = Object.freeze({
    MIN_MEMBERS: 40,
    MAX_ACTIVE_STRIKES: 1,
    CHECKIN_CURRENT_WINDOW_DAYS: 35,
});

// Pure evaluation of whether an Active league keeps its tier. Same checks
// shape as the entry evaluator. An unverifiable member count passes: demotion
// must never be triggered by a failed data fetch.
function evaluateActiveLeagueRetention({
    memberCount,
    lastCheckinDate,
    activeStrikes,
    now = new Date(),
} = {}) {
    const R = ACTIVE_LEAGUE_RETENTION;
    const nowTime = now.getTime();

    const members = !Number.isFinite(memberCount) || memberCount >= R.MIN_MEMBERS;
    const lastCheckinTime = toTime(lastCheckinDate);
    const checkins = lastCheckinTime !== null
        && nowTime - lastCheckinTime <= R.CHECKIN_CURRENT_WINDOW_DAYS * DAY_MS;
    const strikes = Number(activeStrikes) || 0;
    const strikesOk = strikes <= R.MAX_ACTIVE_STRIKES;

    const checks = Object.freeze([
        Object.freeze({
            code: 'MEMBERS',
            ok: members,
            label: `Hold at least ${R.MIN_MEMBERS} members`,
            detail: Number.isFinite(memberCount) ? `currently ${memberCount}` : 'could not be verified',
        }),
        Object.freeze({
            code: 'CHECKINS',
            ok: checkins,
            label: 'Stay current on monthly check-ins',
            detail: checkins ? 'check-in current' : 'no check-in in the last 35 days',
        }),
        Object.freeze({
            code: 'STRIKES',
            ok: strikesOk,
            label: `No more than ${R.MAX_ACTIVE_STRIKES} active strike`,
            detail: `${strikes} active strike(s)`,
        }),
    ]);

    return Object.freeze({ ok: checks.every((c) => c.ok), checks });
}

module.exports = {
    STRIKE_GATE_THRESHOLD,
    HEALTH,
    APPEAL_STATUS,
    ACTIVE_LEAGUE_REQUIREMENTS,
    ACTIVE_LEAGUE_RETENTION,
    deriveHealthStatus,
    activeStrikeGate,
    appealEligibility,
    evaluateActiveLeagueRequirements,
    evaluateActiveLeagueRetention,
};
