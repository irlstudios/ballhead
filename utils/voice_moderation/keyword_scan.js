'use strict';

// Word-boundary keyword scan over a transcript chunk. Pure; lists are
// injectable for tests and default to config/voice_keywords.

const { TIER1, TIER2 } = require('../../config/voice_keywords');

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const matchList = (text, list) => {
    const found = list.filter((keyword) =>
        new RegExp(`\\b${escapeRegex(keyword)}\\b`, 'i').test(text));
    return [...new Set(found.map((keyword) => keyword.toLowerCase()))];
};

const scanTranscript = (text, { tier1 = TIER1, tier2 = TIER2 } = {}) => ({
    tier1: matchList(text, tier1),
    tier2: matchList(text, tier2),
});

module.exports = { scanTranscript };
