'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { getLatestFollowerCount } = require('../commands/content_creator/cc_check_account');

// Reels Data column layout (index): 0 P Username, 1 P ID, 2 Like Count,
// 3 Post URL, 4 Post Date, 5 Follower Count, ... 12 Points, 13 Is Valid?, 14 Week
function postRow({ username, postDate, followers }) {
    const row = new Array(15).fill('');
    row[0] = username;
    row[1] = '75544766933';
    row[4] = postDate;
    row[5] = followers;
    return row;
}

test('uses the follower count from the most recent post by date', () => {
    // Same Instagram P ID reused across a username change: old fw_cj67 rows
    // (22 followers, February) plus current deadzone.gc1 rows (97 followers, June).
    const posts = [
        postRow({ username: 'fw_cj67', postDate: '02/01/2026', followers: '22' }),
        postRow({ username: 'fw_cj67', postDate: '03/15/2026', followers: '56' }),
        postRow({ username: 'deadzone.gc1', postDate: '06/16/2026', followers: '97' }),
        postRow({ username: 'deadzone.gc1', postDate: '06/15/2026', followers: '97' }),
    ];
    assert.strictEqual(getLatestFollowerCount(posts), '97');
});

test('returns N/A for empty input', () => {
    assert.strictEqual(getLatestFollowerCount([]), 'N/A');
    assert.strictEqual(getLatestFollowerCount(undefined), 'N/A');
});

test('skips rows with a blank follower count when picking the latest', () => {
    const posts = [
        postRow({ username: 'deadzone.gc1', postDate: '06/20/2026', followers: '' }),
        postRow({ username: 'deadzone.gc1', postDate: '06/15/2026', followers: '90' }),
    ];
    assert.strictEqual(getLatestFollowerCount(posts), '90');
});

test('falls back to first available count when no dates parse', () => {
    const posts = [
        postRow({ username: 'deadzone.gc1', postDate: '', followers: '40' }),
        postRow({ username: 'deadzone.gc1', postDate: '', followers: '41' }),
    ];
    assert.strictEqual(getLatestFollowerCount(posts), '40');
});
