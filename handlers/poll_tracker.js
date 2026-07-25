'use strict';

const logger = require('../utils/logger');
const { upsertPollPost, deletePollPostBoardsExcept } = require('../db');
const { resolveBoards } = require('../utils/poll_logic');
const {
    GAME_IDEAS_FORUM_CHANNEL_ID,
    BUG_REPORTS_FORUM_CHANNEL_ID,
    BOARD_TAG_MAP,
} = require('../config/constants');

// Reconcile a forum thread's rows in poll_posts with the boards it currently
// belongs to. Called on create, update (tags change), and delete (boards = []).
const indexThread = async (thread) => {
    if (!thread || !thread.parentId) {
        return;
    }
    if (thread.parentId !== GAME_IDEAS_FORUM_CHANNEL_ID && thread.parentId !== BUG_REPORTS_FORUM_CHANNEL_ID) {
        return;
    }

    const boards = resolveBoards({
        parentId: thread.parentId,
        appliedTags: Array.isArray(thread.appliedTags) ? thread.appliedTags : [],
        gameIdeasForumId: GAME_IDEAS_FORUM_CHANNEL_ID,
        bugsForumId: BUG_REPORTS_FORUM_CHANNEL_ID,
        boardTagMap: BOARD_TAG_MAP,
    });

    // Upsert before deleting: a new board row inherits promoted_at from the rows
    // being replaced (so retagging a post does not re-trigger its Top 5 nudge), and
    // the post is never briefly absent from the catalog mid-reconcile.
    for (const board of boards) {
        await upsertPollPost({
            threadId: thread.id,
            board,
            title: thread.name || null,
            url: thread.url || null,
            createdAt: thread.createdAt || null,
        });
    }
    await deletePollPostBoardsExcept(thread.id, boards);
    logger.info(`[Poll] Indexed thread ${thread.id} -> [${boards.join(', ') || 'none'}]`);
};

module.exports = { indexThread };
