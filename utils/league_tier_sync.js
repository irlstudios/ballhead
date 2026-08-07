'use strict';

// Pure tier-movement decisions for the daily league tier sync. Base leagues
// meeting the entry requirements are promoted to Active; Active leagues below
// the retention keep-bar are demoted to Base. Sponsored leagues are managed
// manually and never auto-moved.

const {
    evaluateActiveLeagueRequirements,
    evaluateActiveLeagueRetention,
} = require('./league_enforcement');

// Stored member counts come from the weekly health check. Older than this and
// the count is treated as unverifiable: it can neither promote nor demote.
const MEMBER_COUNT_FRESH_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

function verifiedMemberCount(league, now) {
    const checkedAt = league.last_health_check ? new Date(league.last_health_check).getTime() : NaN;
    if (Number.isNaN(checkedAt) || now.getTime() - checkedAt > MEMBER_COUNT_FRESH_DAYS * DAY_MS) {
        return null;
    }
    return league.member_count;
}

const NO_STANDING = Object.freeze({ tier: null, meets: null, checks: Object.freeze([]) });

// Where a league stands against its tier bar: entry requirements for Base,
// retention keep-bar for Active, nothing for Sponsored or non-live leagues.
function tierStanding(league, now = new Date()) {
    if (league.league_status && league.league_status !== 'Active') {
        return NO_STANDING;
    }
    if (league.league_type === 'Base') {
        const result = evaluateActiveLeagueRequirements({
            memberCount: verifiedMemberCount(league, now),
            approvalDate: league.approval_date,
            lastCheckinDate: league.last_checkin_date,
            checkinMonths: league.checkin_months,
            activeStrikes: league.active_strikes,
            healthStatus: league.health_status,
            now,
        });
        return Object.freeze({ tier: 'Base', meets: result.ok, checks: result.checks });
    }
    if (league.league_type === 'Active') {
        const result = evaluateActiveLeagueRetention({
            memberCount: verifiedMemberCount(league, now),
            lastCheckinDate: league.last_checkin_date,
            activeStrikes: league.active_strikes,
            now,
        });
        return Object.freeze({ tier: 'Active', meets: result.ok, checks: result.checks });
    }
    return NO_STANDING;
}

function decideTierMoves(leagues, now = new Date()) {
    const promotions = [];
    const demotions = [];

    for (const league of leagues || []) {
        const standing = tierStanding(league, now);
        if (standing.tier === 'Base' && standing.meets) {
            promotions.push(Object.freeze({ league, checks: standing.checks }));
        } else if (standing.tier === 'Active' && standing.meets === false) {
            demotions.push(Object.freeze({ league, checks: standing.checks }));
        }
    }

    return Object.freeze({ promotions, demotions });
}

module.exports = { decideTierMoves, tierStanding, verifiedMemberCount };
