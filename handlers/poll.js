'use strict';

const { getUserBoardList, saveUserBoardList } = require('../db');
const { moveItem, removeItem } = require('../utils/poll_logic');
const { buildUserListReply } = require('../utils/poll_view');

// custom_id shape: poll:<action>:<board>:<index>  (index is 0-based)
const handlePollButton = async (interaction) => {
    const [, action, board, indexRaw] = interaction.customId.split(':');
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
    await interaction.update(await buildUserListReply(interaction.user.id, board));
};

module.exports = { handlePollButton };
