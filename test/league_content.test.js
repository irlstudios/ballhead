'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
    normalizeHashtag,
    isValidHashtag,
    contentSubmissionEligibility,
    isValidContentUrl,
    buildContentSummaryLine,
} = require('../utils/league_content');

test('normalizeHashtag strips # and lowercases', () => {
    assert.strictEqual(normalizeHashtag('#SkyBallers'), 'skyballers');
    assert.strictEqual(normalizeHashtag('  ##Foo_1  '), 'foo_1');
    assert.strictEqual(normalizeHashtag(''), '');
    assert.strictEqual(normalizeHashtag(null), '');
});

test('isValidHashtag enforces 2-30 alphanumeric/underscore', () => {
    assert.strictEqual(isValidHashtag('#SkyBallers'), true);
    assert.strictEqual(isValidHashtag('a'), false); // too short
    assert.strictEqual(isValidHashtag('has space'), false);
    assert.strictEqual(isValidHashtag('emoji😀tag'), false);
    assert.strictEqual(isValidHashtag('x'.repeat(31)), false);
});

test('contentSubmissionEligibility allows active Active/Sponsored leagues', () => {
    assert.strictEqual(contentSubmissionEligibility({ league_type: 'Active', league_status: 'Active' }).ok, true);
    assert.strictEqual(contentSubmissionEligibility({ league_type: 'Sponsored', league_status: 'Active' }).ok, true);
});

test('contentSubmissionEligibility blocks base, inactive, and missing leagues', () => {
    assert.strictEqual(contentSubmissionEligibility(null).code, 'NO_LEAGUE');
    assert.strictEqual(contentSubmissionEligibility({ league_type: 'Base', league_status: 'Active' }).code, 'INELIGIBLE_TIER');
    assert.strictEqual(contentSubmissionEligibility({ league_type: 'Active', league_status: 'Inactive' }).code, 'NOT_ACTIVE');
});

test('isValidContentUrl mirrors http(s) validation', () => {
    assert.strictEqual(isValidContentUrl('https://youtu.be/x'), true);
    assert.strictEqual(isValidContentUrl('nope'), false);
});

test('buildContentSummaryLine formats counts', () => {
    assert.strictEqual(buildContentSummaryLine({ count: 4, totalViews: 1200 }), 'Content posts: **4** | Total views: **1200**');
    assert.strictEqual(buildContentSummaryLine(), 'Content posts: **0** | Total views: **0**');
});
