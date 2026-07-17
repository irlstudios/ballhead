'use strict';

const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ContainerBuilder, TextDisplayBuilder, MessageFlags,
} = require('discord.js');
const { getUserBoardList } = require('../db');

const BOARD_LABEL = { gameplay: 'Gameplay', skins: 'Skins', bugs: 'Bugs' };

// Ephemeral view of a user's ranked list for one board, with a row of
// Up / Down / Remove buttons per item. Buttons re-render the same message.
const buildUserListReply = async (userId, board) => {
    const rows = await getUserBoardList(userId, board);

    const lines = rows.length
        ? rows.map((r, i) => `**${i + 1}.** ${r.title ? `[${r.title}](${r.url})` : '_(removed post)_'}`)
        : ['_Your list is empty. Add posts with_ `/myideas add`.'];

    const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            [`## Your Top 5 - ${BOARD_LABEL[board] || board}`, '', ...lines].join('\n')
        )
    );

    const buttonRows = rows.map((r, i) => new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`poll:up:${board}:${i}`)
            .setLabel(`#${i + 1} Up`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(i === 0),
        new ButtonBuilder()
            .setCustomId(`poll:down:${board}:${i}`)
            .setLabel(`#${i + 1} Down`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(i === rows.length - 1),
        new ButtonBuilder()
            .setCustomId(`poll:remove:${board}:${i}`)
            .setLabel(`#${i + 1} Remove`)
            .setStyle(ButtonStyle.Danger)
    ));

    return { flags: MessageFlags.IsComponentsV2, components: [container, ...buttonRows] };
};

module.exports = { buildUserListReply, BOARD_LABEL };
