'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { LEAGUE_GUIDE_SECTIONS, buildLeagueGuidePayload } = require('../utils/league_guide');
const { ACTIVE_LEAGUE_REQUIREMENTS } = require('../utils/league_enforcement');

const allText = () => LEAGUE_GUIDE_SECTIONS
    .map(s => [s.title, ...(s.lines || [])].join('\n'))
    .join('\n');

test('guide covers the owner-facing essentials', () => {
    const text = allText();
    for (const command of [
        '/league checkin', '/league settings', '/league update-invite',
        '/league add-co-owner', '/league submit-game', '/league appeal',
        '/league requirements', '/league guide', '/league content',
    ]) {
        assert.ok(text.includes(command), `guide should mention ${command}`);
    }
});

test('guide explains the content hashtag system', () => {
    const text = allText();
    assert.ok(text.includes('hashtag'), 'hashtag system missing');
    assert.ok(text.includes('#gc'), 'hashtag #gc prefix rule missing');
});

test('guide states the Active League requirements from the source constants', () => {
    const text = allText();
    assert.ok(text.includes(String(ACTIVE_LEAGUE_REQUIREMENTS.MIN_MEMBERS)), 'member minimum missing');
    assert.ok(text.includes(String(ACTIVE_LEAGUE_REQUIREMENTS.MIN_TENURE_DAYS)), 'tenure minimum missing');
    assert.ok(
        text.includes(String(ACTIVE_LEAGUE_REQUIREMENTS.MIN_CONSECUTIVE_CHECKIN_MONTHS)),
        'check-in streak minimum missing'
    );
});

test('guide fits inside the Components V2 text budget', () => {
    // 4000 characters is the hard cap across text display components; leave headroom.
    assert.ok(allText().length <= 3800, `guide is ${allText().length} chars`);
});

test('buildLeagueGuidePayload returns a sendable Components V2 payload', () => {
    const payload = buildLeagueGuidePayload();
    assert.ok(payload.flags, 'payload should set IsComponentsV2 flag');
    assert.ok(Array.isArray(payload.components) && payload.components.length > 0);
});
