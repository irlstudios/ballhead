'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { runPollNudge } = require('../jobs/poll-nudge');

// A forum thread fake that records what the job sent to it.
const thread = (id, overrides = {}) => ({
    id,
    sent: [],
    locked: false,
    archived: false,
    async send(payload) {
        this.sent.push(payload);
    },
    async setArchived(value) {
        this.archived = value;
    },
    ...overrides,
});

// Builds an injectable deps object plus a client whose channel fetches resolve
// against the given threads (an unknown id resolves to null, as discord.js does).
function harness(posts, threads) {
    const marked = [];
    const byId = new Map(threads.map((t) => [t.id, t]));
    return {
        marked,
        client: { channels: { fetch: async (id) => byId.get(id) ?? Promise.reject(new Error('unknown')) } },
        deps: {
            listPosts: async () => posts,
            markPromoted: async (threadId) => marked.push(threadId),
        },
    };
}

test('posts a nudge with the add button into each candidate thread', async () => {
    const t = thread('1', { boards: ['gameplay'] });
    const h = harness([{ thread_id: '1', boards: ['gameplay'] }], [t]);

    const posted = await runPollNudge(h.client, h.deps);

    assert.strictEqual(posted, 1);
    assert.strictEqual(t.sent.length, 1);
    const ids = t.sent[0].components
        .flatMap((c) => c.toJSON().components || [])
        .map((c) => c.custom_id)
        .filter(Boolean);
    assert.deepStrictEqual(ids, ['poll:add']);
});

test('marks a thread promoted even when it cannot be posted in', async () => {
    const locked = thread('1', { locked: true });
    const h = harness(
        [{ thread_id: '1', boards: ['bugs'] }, { thread_id: 'gone', boards: ['bugs'] }],
        [locked]
    );

    const posted = await runPollNudge(h.client, h.deps);

    assert.strictEqual(posted, 0);
    assert.strictEqual(locked.sent.length, 0);
    // Both are marked, so neither jams the front of the queue on the next run.
    assert.deepStrictEqual(h.marked, ['1', 'gone']);
});

test('reopens an archived thread before posting', async () => {
    const archived = thread('1', { archived: true });
    const h = harness([{ thread_id: '1', boards: ['skins'] }], [archived]);

    const posted = await runPollNudge(h.client, h.deps);

    assert.strictEqual(posted, 1);
    assert.strictEqual(archived.archived, false);
    assert.strictEqual(archived.sent.length, 1);
});

test('a thread that refuses to reopen is skipped, not sent to', async () => {
    const stuck = thread('1', {
        archived: true,
        setArchived: async () => {
            throw new Error('missing permissions');
        },
    });
    const h = harness([{ thread_id: '1', boards: ['skins'] }], [stuck]);

    const posted = await runPollNudge(h.client, h.deps);

    assert.strictEqual(posted, 0);
    assert.strictEqual(stuck.sent.length, 0);
    assert.deepStrictEqual(h.marked, ['1']);
});

test('one failing send does not abort the rest of the batch', async () => {
    const bad = thread('1', { send: async () => {
        throw new Error('rate limited');
    } });
    const good = thread('2');
    const h = harness(
        [{ thread_id: '1', boards: ['bugs'] }, { thread_id: '2', boards: ['bugs'] }],
        [bad, good]
    );

    const posted = await runPollNudge(h.client, h.deps);

    assert.strictEqual(posted, 1);
    assert.strictEqual(good.sent.length, 1);
});

test('a failing query yields zero nudges instead of throwing', async () => {
    const posted = await runPollNudge({}, {
        listPosts: async () => {
            throw new Error('db down');
        },
    });
    assert.strictEqual(posted, 0);
});
