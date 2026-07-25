'use strict';

const { ContextMenuCommandBuilder, ApplicationCommandType } = require('discord.js');
const { addPostFromThread } = require('../../utils/poll_add');

module.exports = {
    data: new ContextMenuCommandBuilder()
        .setName('Add to my Top 5')
        .setType(ApplicationCommandType.Message),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        // A forum post's messages live in the post's thread, so the message's
        // channelId is the thread id we index in poll_posts.
        return addPostFromThread(interaction, interaction.targetMessage.channelId);
    },
};
