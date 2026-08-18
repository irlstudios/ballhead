'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const moment = require('moment');

const {
    getPlatformData,
    computeCalendarWeekStats,
    formatPlatformEmbed
} = require('../commands/content_creator/cc_check_account');

const APP_RANGE = 'CC Applications!A:G';
const DATA_RANGE = 'Reels Data!A:O';
const CREATORS_RANGE = 'Creators!A:K';

// Reels Data columns: 0 P Username, 1 P ID, 4 Post Date, 5 Followers,
// 11 Quality Score, 12 Points Earned, 13 Is Valid?, 14 Season Week
function postRow({ username, postDate, points = '0', isValid = 'TRUE', quality = '0', followers = '100' }) {
    const row = new Array(15).fill('');
    row[0] = username;
    row[1] = '75544766933';
    row[4] = postDate;
    row[5] = followers;
    row[11] = quality;
    row[12] = points;
    row[13] = isValid;
    row[14] = '10';
    return row;
}

// Creators columns: 0 Platform, 1 Status, 2 Username, 3 DD ID, 4 P ID
function creatorRow({ status = 'Active', username = 'gc_creator', discordId = '111', platformId = '75544766933' }) {
    return ['Reels', status, username, discordId, platformId];
}

// CC Applications columns: 0 Platform, 1 Username, 2 DD ID, 3 Submitted At, 4 P ID
function appRow({ username = 'gc_applicant', discordId = '222', platformId = '99999' }) {
    return ['Reels', username, discordId, '01/05/2026', platformId];
}

function buildValues({ apps = [], posts = [], creators = [] }) {
    return new Map([
        [APP_RANGE, apps],
        [DATA_RANGE, posts],
        [CREATORS_RANGE, creators]
    ]);
}

test('returns creator data when the user is on the roster with no application row', () => {
    const lastWeek = moment().subtract(1, 'week').startOf('week').add(2, 'days').format('MM/DD/YYYY');
    const values = buildValues({
        creators: [creatorRow({ status: 'Active', username: 'gc_creator', discordId: '111' })],
        posts: [postRow({ username: 'gc_creator', postDate: lastWeek, points: '9' })]
    });

    const data = getPlatformData('reels', '111', values);
    assert.ok(data, 'expected platform data for a promoted creator');
    assert.strictEqual(data.appRow, null);
    assert.strictEqual(data.creatorStatus, 'Active');
    assert.strictEqual(data.username, 'gc_creator');
    assert.strictEqual(data.userPosts.length, 1);
});

test('finds a creator whose blank P ID column was trimmed by Sheets', () => {
    const lastWeek = moment().subtract(1, 'week').startOf('week').add(2, 'days').format('MM/DD/YYYY');
    const values = buildValues({
        // Sheets omits trailing blank cells: no P ID column at all
        creators: [['Reels', 'Active', 'gc_creator', '111']],
        posts: [postRow({ username: 'gc_creator', postDate: lastWeek, points: '8' })]
    });

    const data = getPlatformData('reels', '111', values);
    assert.ok(data, 'expected creator with blank P ID to be found');
    assert.strictEqual(data.username, 'gc_creator');
    assert.strictEqual(data.userPosts.length, 1, 'posts should still match by username');
});

test('returns null when the user has neither an application nor a creator row', () => {
    const values = buildValues({});
    assert.strictEqual(getPlatformData('reels', '333', values), null);
});

test('still returns application data for applicants', () => {
    const values = buildValues({
        apps: [appRow({ username: 'gc_applicant', discordId: '222' })],
        posts: [postRow({ username: 'gc_applicant', postDate: '01/06/2026' })]
    });

    const data = getPlatformData('reels', '222', values);
    assert.ok(data);
    assert.ok(data.appRow);
    assert.strictEqual(data.creatorRow, null);
    assert.strictEqual(data.username, 'gc_applicant');
});

test('computeCalendarWeekStats sums valid post points into the right week', () => {
    const lastWeek = moment().subtract(1, 'week').startOf('week').add(1, 'days').format('MM/DD/YYYY');
    const twoWeeksAgo = moment().subtract(2, 'weeks').startOf('week').add(1, 'days').format('MM/DD/YYYY');
    const posts = [
        postRow({ username: 'x', postDate: lastWeek, points: '4', quality: '3' }),
        postRow({ username: 'x', postDate: lastWeek, points: '5', quality: '5' }),
        postRow({ username: 'x', postDate: twoWeeksAgo, points: '4', isValid: 'FALSE' })
    ];

    const stats = computeCalendarWeekStats(posts);
    assert.strictEqual(stats.length, 3);
    // Oldest first: [3 weeks ago, 2 weeks ago, last week]
    assert.strictEqual(stats[2].totalPoints, 9);
    assert.strictEqual(stats[2].validPosts, 2);
    assert.strictEqual(stats[1].totalPoints, 0);
    assert.strictEqual(stats[1].totalPosts, 1);
    assert.strictEqual(stats[0].totalPoints, 0);
});

test('formatPlatformEmbed shows weekly progress for roster creators', () => {
    const lastWeek = moment().subtract(1, 'week').startOf('week').add(2, 'days').format('MM/DD/YYYY');
    const values = buildValues({
        creators: [creatorRow({ status: 'Base', username: 'gc_creator', discordId: '111' })],
        posts: [postRow({ username: 'gc_creator', postDate: lastWeek, points: '9', quality: '4' })]
    });

    const data = getPlatformData('reels', '111', values);
    const field = formatPlatformEmbed('reels', data);

    assert.match(field.value, /\*\*Status:\*\* Base Content Creator/);
    assert.match(field.value, /Last week/);
    assert.match(field.value, /9\.0/);
    assert.ok(!field.value.includes('silly'), 'old dead-end message should be gone');
});

test('formatPlatformEmbed handles a creator with no tracked posts', () => {
    const values = buildValues({
        creators: [creatorRow({ status: 'Active', username: 'gc_creator', discordId: '111' })]
    });

    const data = getPlatformData('reels', '111', values);
    const field = formatPlatformEmbed('reels', data);

    assert.match(field.value, /\*\*Status:\*\* Active Content Creator/);
    assert.match(field.value, /Last week/);
});
