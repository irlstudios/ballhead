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

// Public, button-free one-liner announcing that someone added a post to a board,
// so the community sees the activity. No components a bystander could interact with.
const buildAddBroadcast = (name, board, post) => {
    const label = BOARD_LABEL[board] || board;
    const link = post && post.title
        ? (post.url ? `[${post.title}](${post.url})` : `**${post.title}**`)
        : 'a post';
    const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`**${name}** added ${link} to the **${label}** Top 5.`)
    );
    return { flags: MessageFlags.IsComponentsV2, components: [container] };
};

// Promo Ballhead posts into a forum thread so readers learn the post can go in
// their personal Top 5, with a one-click way to do it. The button carries no board
// so a click resolves the thread's current boards then, not whatever they were
// when this was posted.
const buildNudge = (boards = []) => {
    const label = boards.length === 1 ? BOARD_LABEL[boards[0]] : null;
    const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent([
            '### Like this one?',
            `Add it to your **Top 5${label ? ` ${label}` : ''}** picks and it scores points on the community leaderboard the team reviews.`,
            'Everyone gets five picks per board. Use `/myideas view` to reorder yours, or `/leaderboard` to see what is winning.',
        ].join('\n'))
    );
    const buttonRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('poll:add')
            .setLabel('Add to my Top 5')
            .setStyle(ButtonStyle.Success)
    );
    return { flags: MessageFlags.IsComponentsV2, components: [container, buttonRow] };
};

module.exports = { buildUserListReply, buildAddBroadcast, buildNudge, BOARD_LABEL };
