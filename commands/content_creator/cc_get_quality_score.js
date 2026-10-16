'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { replyWithCcRedirect } = require('../../utils/cc_redirect');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('cc-quality-score')
        .setDescription('Post quality scores moved to /cc_post_feedback'),
    async execute(interaction) {
        return replyWithCcRedirect(interaction, 'Post Scores Moved to /cc_post_feedback');
    },
};
