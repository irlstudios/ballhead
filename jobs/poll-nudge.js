'use strict';

const logger = require('../utils/logger');
const { getUnpromotedPollPosts, markPollPostPromoted } = require('../db');
const { buildNudge } = require('../utils/poll_view');

// A handful of posts a day, newest first, so the forums see a steady trickle of
// "you can vote on this" rather than one burst that reads as spam.
const NUDGE_LIMIT = 3;
// Older posts are past the point where a nudge would draw readers back.
const NUDGE_MAX_AGE_DAYS = 14;

// Post the Top 5 nudge (with its add button) into recent idea/bug threads that have
// not had one yet. Each thread is marked before sending so a thread we cannot post
// in is skipped for good instead of blocking the front of the queue every run.
const runPollNudge = async (client, deps = {}) => {
    const {
        listPosts = getUnpromotedPollPosts,
        markPromoted = markPollPostPromoted,
        limit = NUDGE_LIMIT,
        maxAgeDays = NUDGE_MAX_AGE_DAYS,
    } = deps;

    let posted = 0;
    let posts = [];
    try {
        posts = await listPosts(limit, maxAgeDays);
    } catch (error) {
        logger.error('[PollNudge] Failed to load posts to nudge:', error);
        return 0;
    }

    for (const post of posts) {
        try {
            await markPromoted(post.thread_id);
            const thread = await client.channels.fetch(post.thread_id).catch(() => null);
            if (!thread || thread.locked) {
                continue;
            }
            // Posting into an archived thread fails unless it is reopened first;
            // reopening also bumps the post back up the forum, which is the point.
            if (thread.archived && !(await thread.setArchived(false).then(() => true).catch(() => false))) {
                continue;
            }
            await thread.send(buildNudge(post.boards || []));
            posted += 1;
        } catch (error) {
            logger.error(`[PollNudge] Failed to nudge thread ${post.thread_id}:`, error);
        }
    }

    logger.info(`[PollNudge] Posted ${posted} nudge(s) of ${posts.length} candidate(s).`);
    return posted;
};

module.exports = { runPollNudge, NUDGE_LIMIT, NUDGE_MAX_AGE_DAYS };
