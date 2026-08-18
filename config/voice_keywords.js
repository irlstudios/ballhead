'use strict';

// Keyword lists for public room voice flagging. Tier 1 fires an immediate
// mod alert with an evidence clip; tier 2 is counted in logs only so alert
// precision can be judged before promoting a term. Staff own these lists.
//
// Curation rules:
// - Entries are lowercase; matching is case-insensitive on word boundaries.
// - Tier 1 is reserved for terms that are alert-worthy in nearly any context
//   in this community: severe slurs, credible threat phrases, self-harm
//   incitement, and grooming-pattern phrases (the player base skews young).
// - Terms with heavy benign overlap or high banter volume start in tier 2;
//   promote only after shadow data shows acceptable precision.

const TIER1 = [
    // Severe slurs
    'nigger',
    'chink',
    'spic',
    'wetback',
    'beaner',
    'gook',
    'kike',
    'towelhead',
    'porch monkey',
    'faggot',
    'tranny',
    // Self-harm incitement
    'kill yourself',
    'kill your self',
    'kys',
    'neck yourself',
    'hang yourself',
    'shoot yourself',
    'slit your wrists',
    // Threats and doxxing
    'i know where you live',
    'i will kill you',
    'ill kill you',
    'swat you',
    'rape you',
    'molest',
    // Grooming patterns
    'send nudes',
    'dont tell your parents',
    'do not tell your parents',
    'are you home alone',
    'are your parents home',
    'are you by yourself',
    'whats your address',
    'what is your address',
    'pedo',
    'pedophile',
    'groomer',
];

const TIER2 = [
    'nigga',
    'fag',
    'dyke',
    'coon',
    'retard',
    'retarded',
    'home alone',
];

module.exports = { TIER1, TIER2 };
