'use strict';

const { getUserBoardList, saveUserBoardList } = require('../db');
const { moveItem, removeItem } = require('../utils/poll_logic');
const { buildUserListReply } = require('../utils/poll_view');
const { addPostFromThread } = require('../utils/poll_add');

// custom_id shapes: poll:<up|down|remove>:<board>:<index> on a user's own ephemeral
// list (index is 0-based), and a bare poll:add on the public nudge posted in a
// forum thread, where the thread the button lives in is the post being added.
const handlePollButton = async (interaction) => {
    const [, action, board, indexRaw] = interaction.customId.split(':');

    if (action === 'add') {
        await interaction.deferReply({ ephemeral: true });
        // No broadcast: the add already happened in the thread everyone is reading,
        // so a public one-liner per click would just be noise.
        return addPostFromThread(interaction, interaction.channelId, { broadcast: false });
    }

    await interaction.deferUpdate();
    const index = parseInt(indexRaw, 10);

    const list = (await getUserBoardList(interaction.user.id, board)).map((r) => r.thread_id);
    let next = list;
    if (action === 'up') {
        next = moveItem(list, index, 'up');
    } else if (action === 'down') {
        next = moveItem(list, index, 'down');
    } else if (action === 'remove') {
        next = removeItem(list, index);
    }

    if (next !== list) {
        await saveUserBoardList(interaction.user.id, board, next);
    }
    return interaction.editReply(await buildUserListReply(interaction.user.id, board));
};

module.exports = { handlePollButton };
