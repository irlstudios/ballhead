'use strict';

const { SlashCommandBuilder } = require('@discordjs/builders');
const { noticePayload } = require('../../utils/ui');
const {
    getPollPostBoards, getUserBoardList, saveUserBoardList, searchPollPosts,
} = require('../../db');
const { appendToList } = require('../../utils/poll_logic');
const { buildUserListReply } = require('../../utils/poll_view');

const BOARD_CHOICES = [
    { name: 'Gameplay', value: 'gameplay' },
    { name: 'Skins', value: 'skins' },
    { name: 'Bugs', value: 'bugs' },
];

const notice = (interaction, message, subtitle = 'Top 5') =>
    interaction.editReply({ ...noticePayload(message, { title: 'Top 5', subtitle }) });

const addToList = async (interaction, board) => {
    const threadId = interaction.options.getString('post');
    const boards = await getPollPostBoards(threadId);
    if (!boards.includes(board)) {
        return notice(interaction, 'That post is not in the selected board. Pick a suggestion from the search list.');
    }
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
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('myideas')
        .setDescription('Manage your personal top-5 idea and bug lists')
        .addSubcommand((s) => s
            .setName('add')
            .setDescription('Add a post to one of your top-5 lists')
            .addStringOption((o) => o.setName('board').setDescription('Which list').setRequired(true).addChoices(...BOARD_CHOICES))
            .addStringOption((o) => o.setName('post').setDescription('Search posts by title').setRequired(true).setAutocomplete(true)))
        .addSubcommand((s) => s
            .setName('view')
            .setDescription('View and reorder one of your top-5 lists')
            .addStringOption((o) => o.setName('board').setDescription('Which list').setRequired(true).addChoices(...BOARD_CHOICES))),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const board = interaction.options.getString('board');
        const sub = interaction.options.getSubcommand();
        if (sub === 'add') {
            return addToList(interaction, board);
        }
        return interaction.editReply(await buildUserListReply(interaction.user.id, board));
    },

    async autocomplete(interaction) {
        const board = interaction.options.getString('board');
        const focused = interaction.options.getFocused();
        if (!board) {
            return interaction.respond([]);
        }
        const rows = await searchPollPosts(board, focused);
        return interaction.respond(
            rows.map((r) => ({ name: (r.title || 'Untitled').slice(0, 100), value: r.thread_id }))
        );
    },
};
