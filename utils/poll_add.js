'use strict';

const { noticePayload } = require('./ui');
const { getPollPostBoards, getUserBoardList, saveUserBoardList } = require('../db');
const { appendToList } = require('./poll_logic');
const { buildUserListReply, buildAddBroadcast, buildBoardPicker } = require('./poll_view');
const { indexThread } = require('../handlers/poll_tracker');
const { GAME_IDEAS_FORUM_CHANNEL_ID } = require('../config/constants');

// Shared add-to-top-5 flow for every entry point (slash command, message context
// menu, in-thread nudge button). All callers must have already deferred an
// ephemeral reply.

const notice = (interaction, message, subtitle = 'Top 5') =>
    interaction.editReply(noticePayload(message, { title: 'Top 5', subtitle }));

// Which single board a forum thread belongs to, for callers that did not pick one.
// Indexes the thread live first so this works on a brand-new post the catalog has
// not caught up with yet. Returns { board }, { choices } when the post is in more
// than one and the user has to pick, or { error, subtitle }.
const resolveSingleBoard = async (client, threadId) => {
    const thread = await client.channels.fetch(threadId).catch(() => null);
    if (thread) {
        await indexThread(thread);
    }
    const boards = await getPollPostBoards(threadId);

    if (boards.length === 0) {
        // A game-ideas post with no Gameplay/Skins tag has no board to go in;
        // anything outside the two poll forums is not addable at all.
        const needsTag = thread?.parentId === GAME_IDEAS_FORUM_CHANNEL_ID;
        return needsTag
            ? {
                error: 'This idea needs a **Gameplay** or **Skins** tag before it can be added. Ask a mod to tag the post, then try again.',
                subtitle: 'Needs a Tag',
            }
            : {
                error: 'This post is not in the game-ideas or bug-report forums, so it cannot be added to a Top 5.',
                subtitle: 'Not a Poll Post',
            };
    }
    if (boards.length > 1) {
        return { choices: boards };
    }
    return { board: boards[0] };
};

// Append a post to the caller's list for one board. The updated list (with reorder
// buttons) stays ephemeral; when broadcast is on, a public one-liner announces the
// add so bystanders see the activity.
const addPostToBoard = async (interaction, threadId, board, { broadcast = true } = {}) => {
    const userId = interaction.user.id;
    const current = (await getUserBoardList(userId, board)).map((r) => r.thread_id);
    const res = appendToList(current, threadId);
    if (!res.ok) {
        return notice(interaction, res.reason === 'full'
            ? 'That list is already full (5). Remove one with `/myideas view` first.'
            : 'That post is already in your list.');
    }

    await saveUserBoardList(userId, board, res.list);
    await interaction.editReply(await buildUserListReply(userId, board));
    if (!broadcast) {
        return undefined;
    }
    const added = (await getUserBoardList(userId, board)).find((r) => r.thread_id === threadId);
    const name = interaction.member?.displayName ?? interaction.user.username;
    return interaction.followUp(buildAddBroadcast(name, board, added));
};

// Add a forum post from inside its own thread (context menu / nudge button), where
// the board has to be inferred rather than chosen.
const addPostFromThread = async (interaction, threadId, options) => {
    const resolved = await resolveSingleBoard(interaction.client, threadId);
    if (resolved.choices) {
        return interaction.editReply(buildBoardPicker(resolved.choices));
    }
    if (resolved.error) {
        return notice(interaction, resolved.error, resolved.subtitle);
    }
    return addPostToBoard(interaction, threadId, resolved.board, options);
};

module.exports = { notice, resolveSingleBoard, addPostToBoard, addPostFromThread };
