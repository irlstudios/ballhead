'use strict';

const { ContextMenuCommandBuilder, ApplicationCommandType } = require('discord.js');
const { noticePayload } = require('../../utils/ui');
const { getPollPostBoards, getUserBoardList, saveUserBoardList } = require('../../db');
const { appendToList } = require('../../utils/poll_logic');
const { buildUserListReply } = require('../../utils/poll_view');

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
        const boards = await getPollPostBoards(threadId);

        if (boards.length === 0) {
            return notice(interaction, 'This post is not one of the tracked idea or bug boards.');
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
        return interaction.editReply(await buildUserListReply(interaction.user.id, board));
    },
};
