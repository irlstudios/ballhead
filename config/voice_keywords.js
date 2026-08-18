'use strict';

// Keyword lists for public room voice flagging. Tier 1 fires an immediate
// mod alert with an evidence clip; tier 2 is counted in logs only.
// Staff curate these lists; keep entries lowercase.

const TIER1 = [
    'kill yourself',
    'kys',
];

const TIER2 = [
    'trash talk',
];

module.exports = { TIER1, TIER2 };
