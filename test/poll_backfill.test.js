'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { fetchAllArchived } = require('../utils/poll_backfill');

// Fake forum whose fetchArchived returns preset pages, exercising the pagination loop.
function fakeForum(pages) {
    let call = 0;
    return {
        threads: {
            fetchArchived: async () => {
                const page = pages[call] || { threads: [], hasMore: false };
                call += 1;
                return { threads: new Map(page.threads.map((t) => [t.id, t])), hasMore: page.hasMore };
            },
        },
    };
}

test('fetchAllArchived walks every page until hasMore is false', async () => {
    const forum = fakeForum([
        { threads: [{ id: 'a' }, { id: 'b' }], hasMore: true },
        { threads: [{ id: 'c' }], hasMore: false },
    ]);
    const all = await fetchAllArchived(forum);
    assert.deepStrictEqual(all.map((t) => t.id), ['a', 'b', 'c']);
});

test('fetchAllArchived stops on an empty page', async () => {
    const forum = fakeForum([{ threads: [], hasMore: true }]);
    const all = await fetchAllArchived(forum);
    assert.deepStrictEqual(all, []);
});

test('fetchAllArchived respects the maxPages runaway guard', async () => {
    // A forum that always reports hasMore, returning one thread per page.
    let n = 0;
    const forum = {
        threads: {
            fetchArchived: async () => {
                n += 1;
                return { threads: new Map([[`t${n}`, { id: `t${n}` }]]), hasMore: true };
            },
        },
    };
    const all = await fetchAllArchived(forum, 3);
    assert.strictEqual(all.length, 3);
});
