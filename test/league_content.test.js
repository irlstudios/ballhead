'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
    normalizeHashtag,
    isValidHashtag,
    buildContentSummaryLine,
    buildHashtagNudge,
} = require('../utils/league_content');

test('normalizeHashtag strips # and lowercases', () => {
    assert.strictEqual(normalizeHashtag('#GCSkyBallers'), 'gcskyballers');
    assert.strictEqual(normalizeHashtag('  ##GC_Foo_1  '), 'gc_foo_1');
    assert.strictEqual(normalizeHashtag(''), '');
    assert.strictEqual(normalizeHashtag(null), '');
});

test('isValidHashtag requires a gc prefix', () => {
    assert.strictEqual(isValidHashtag('#GCSkyBallers'), true);
    assert.strictEqual(isValidHashtag('gc1'), true);
    assert.strictEqual(isValidHashtag('#skyballers'), false);
    assert.strictEqual(isValidHashtag('gc'), false); // prefix only
    assert.strictEqual(isValidHashtag('#gc'), false);
});

test('isValidHashtag enforces charset and 3-30 length', () => {
    assert.strictEqual(isValidHashtag('gc has space'), false);
    assert.strictEqual(isValidHashtag('gcemoji\u{1F600}tag'), false);
    assert.strictEqual(isValidHashtag(`gc${'x'.repeat(28)}`), true);
    assert.strictEqual(isValidHashtag(`gc${'x'.repeat(29)}`), false);
});

test('buildHashtagNudge only fires for leagues missing a hashtag', () => {
    assert.deepStrictEqual(buildHashtagNudge([{ league_name: 'Sky', league_hashtag: 'gcsky' }]), []);
    assert.deepStrictEqual(buildHashtagNudge([]), []);

    const nudge = buildHashtagNudge([
        { league_name: 'Sky', league_hashtag: 'gcsky' },
        { league_name: 'Dunk', league_hashtag: null },
        { league_name: 'Rim', league_hashtag: '' },
    ]);
    assert.ok(nudge.some((l) => l.includes('Dunk, Rim')));
    assert.ok(nudge.some((l) => l.includes('/league settings')));
    assert.ok(!nudge.some((l) => l.includes('Sky')));
});

test('buildContentSummaryLine formats counts', () => {
    assert.strictEqual(buildContentSummaryLine({ count: 4, totalViews: 1200 }), 'Content posts: **4** | Total views: **1200**');
    assert.strictEqual(buildContentSummaryLine(), 'Content posts: **0** | Total views: **0**');
});
