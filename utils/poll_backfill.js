'use strict';

const logger = require('./logger');
const { indexThread } = require('../handlers/poll_tracker');
const { GAME_IDEAS_FORUM_CHANNEL_ID, BUG_REPORTS_FORUM_CHANNEL_ID } = require('../config/constants');

// Discord returns archived threads in pages of up to 100. Walk every page so old
// posts (which auto-archive after a few days) are indexed, not just the newest 100.
// maxPages caps the walk as a runaway guard.
const fetchAllArchived = async (forum, maxPages = 50) => {
    const out = [];
    let before;
    for (let page = 0; page < maxPages; page++) {
        const res = await forum.threads.fetchArchived(before ? { limit: 100, before } : { limit: 100 });
        const threads = [...res.threads.values()];
        if (threads.length === 0) {
            break;
        }
        out.push(...threads);
        if (!res.hasMore) {
            break;
        }
        before = threads[threads.length - 1];
    }
    return out;
};

const backfillForum = async (client, forumId) => {
    const forum = await client.channels.fetch(forumId).catch(() => null);
    if (!forum || typeof forum.threads?.fetchActive !== 'function') {
        logger.error(`[PollBackfill] Forum ${forumId} not found or not a forum`);
        return 0;
    }
    const active = [...(await forum.threads.fetchActive()).threads.values()];
    const archived = await fetchAllArchived(forum);
    const all = [...active, ...archived];
    for (const thread of all) {
        await indexThread(thread);
    }
    return all.length;
};

// Index every post in both poll forums into poll_posts. Idempotent (upserts), so it
// is safe to run repeatedly. Used by the manual script and the startup catch-up.
const backfillAllForums = async (client) => {
    const ideas = await backfillForum(client, GAME_IDEAS_FORUM_CHANNEL_ID);
    const bugs = await backfillForum(client, BUG_REPORTS_FORUM_CHANNEL_ID);
    logger.info(`[PollBackfill] Indexed ${ideas} game-idea thread(s) and ${bugs} bug thread(s)`);
    return { ideas, bugs };
};

module.exports = { backfillAllForums, backfillForum, fetchAllArchived };
