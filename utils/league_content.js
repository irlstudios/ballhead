'use strict';

// Pure logic for league content hashtags. Owners/co-owners register the hashtag
// they post under; links are never submitted and view counts are tracked
// externally against the hashtag.

// Strip leading '#' and lowercase; hashtags are stored bare and compared bare.
function normalizeHashtag(raw) {
    return (raw || '').trim().replace(/^#+/, '').toLowerCase();
}

// Must start with 'gc' so the tag is identifiably Gym Class, followed by 1-28
// more letters, digits, or underscores.
function isValidHashtag(raw) {
    return /^gc[a-z0-9_]{1,28}$/.test(normalizeHashtag(raw));
}

function buildContentSummaryLine({ count = 0, totalViews = 0 } = {}) {
    return `Content posts: **${count}** | Total views: **${Number(totalViews) || 0}**`;
}

// Check-in nudge for leagues with no hashtag yet. Empty array when every
// league is already set up, so callers can spread it unconditionally.
function buildHashtagNudge(leagues = []) {
    const missing = leagues.filter((l) => l && !l.league_hashtag);
    if (missing.length === 0) return [];
    return [
        `**No content hashtag set:** ${missing.map((l) => l.league_name).join(', ')}`,
        'Set one with `/league settings` using the hashtag option. It must start with #gc, for example #gcskyballers.',
        'Once it is set we track every post using that hashtag and credit your league for it.',
    ];
}

module.exports = {
    normalizeHashtag,
    isValidHashtag,
    buildContentSummaryLine,
    buildHashtagNudge,
};
