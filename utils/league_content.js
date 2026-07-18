'use strict';

// Pure logic for league content submissions + views (Phase 3). Content
// verification and view counts stay manual/external (the mobile app updates
// latest_views later); this module only validates and gates input.

const { isValidHttpUrl, ELIGIBLE_TIERS } = require('./league_officials');

function deny(code, title, message) {
    return Object.freeze({ ok: false, code, title, message });
}
const ALLOW = Object.freeze({ ok: true, code: 'OK', title: null, message: null });

// Strip leading '#' and lowercase; hashtags are stored bare and compared bare.
function normalizeHashtag(raw) {
    return (raw || '').trim().replace(/^#+/, '').toLowerCase();
}

// A hashtag is 2-30 chars of letters, digits, or underscore (post-normalize).
function isValidHashtag(raw) {
    return /^[a-z0-9_]{2,30}$/.test(normalizeHashtag(raw));
}

// Content submission gate: same tier/status rule as officials, but no check-in
// requirement (content flows more freely than official requests).
function contentSubmissionEligibility(league) {
    if (!league) {
        return deny('NO_LEAGUE', 'No League Found', 'You do not own or co-own a registered league.');
    }
    if (!ELIGIBLE_TIERS.includes(league.league_type)) {
        return deny('INELIGIBLE_TIER', 'Active Tier Required', 'Only Active or Sponsored leagues can submit content.');
    }
    if (league.league_status !== 'Active') {
        return deny('NOT_ACTIVE', 'League Not Active', 'Your league must be Active to submit content.');
    }
    return ALLOW;
}

// Validates a content submission's URL (format only, http/https).
function isValidContentUrl(url) {
    return isValidHttpUrl(url);
}

function buildContentSummaryLine({ count = 0, totalViews = 0 } = {}) {
    return `Content posts: **${count}** | Total views: **${Number(totalViews) || 0}**`;
}

module.exports = {
    normalizeHashtag,
    isValidHashtag,
    contentSubmissionEligibility,
    isValidContentUrl,
    buildContentSummaryLine,
};
