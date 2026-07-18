'use strict';

const { ContextMenuCommandBuilder, ApplicationCommandType } = require('discord.js');
const { noticePayload } = require('../../utils/ui');
const { getPollPostBoards, getUserBoardList, saveUserBoardList } = require('../../db');
const { appendToList } = require('../../utils/poll_logic');
const { buildUserListReply, buildAddBroadcast } = require('../../utils/poll_view');
const { indexThread } = require('../../handlers/poll_tracker');
const { GAME_IDEAS_FORUM_CHANNEL_ID } = require('../../config/constants');

const notice = (interaction, message, subtitle = 'Top 5') =>
    interaction.editReply({ ...noticePayload(message, { title: 'Top 5', subtitle }) });

module.exports = {
    data: new ContextMenuCommandBuilder()
        .setName('Add to my Top 5')
        .setType(ApplicationCommandType.Message),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        // A forum post's messages live in the post's thread, so the message's
        // channelId is the thread id we index in poll_posts.
        const threadId = interaction.targetMessage.channelId;
        // Index the post live so this works even if the catalog has not caught up
        // yet (e.g. a brand-new post, or before the startup backfill finished).
        const thread = await interaction.client.channels.fetch(threadId).catch(() => null);
        if (thread) {
            await indexThread(thread);
        }
        const boards = await getPollPostBoards(threadId);

        if (boards.length === 0) {
            // A game-ideas post with no Gameplay/Skins tag has no board to go in;
            // anything outside the two poll forums is not addable at all.
            const needsTag = thread?.parentId === GAME_IDEAS_FORUM_CHANNEL_ID;
            return notice(
                interaction,
                needsTag
                    ? 'This idea needs a **Gameplay** or **Skins** tag before it can be added. Ask a mod to tag the post, then try again.'
                    : 'This post is not in the game-ideas or bug-report forums, so it cannot be added to a Top 5.',
                needsTag ? 'Needs a Tag' : 'Not a Poll Post'
            );
        }
        if (boards.length > 1) {
            return notice(interaction, 'This post is in multiple boards. Use `/myideas add` to choose which list.', 'Choose a Board');
        }

        const board = boards[0];
        const current = (await getUserBoardList(interaction.user.id, board)).map((r) => r.thread_id);
        const res = appendToList(current, threadId);
        if (!res.ok) {
            const msg = res.reason === 'full'
                ? 'That list is already full (5). Remove one with `/myideas view` first.'
                : 'That post is already in your list.';
            return notice(interaction, msg);
        }
        await saveUserBoardList(interaction.user.id, board, res.list);
        // Private management reply (list + reorder buttons) stays ephemeral...
        await interaction.editReply(await buildUserListReply(interaction.user.id, board));
        // ...and a public one-liner announces the add so others see the activity.
        const added = (await getUserBoardList(interaction.user.id, board)).find((r) => r.thread_id === threadId);
        const name = interaction.member?.displayName ?? interaction.user.username;
        return interaction.followUp(buildAddBroadcast(name, board, added));
    },
};
