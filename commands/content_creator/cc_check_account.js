'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { replyWithCcRedirect } = require('../../utils/cc_redirect');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('cc-check-progress')
        .setDescription('Creator progress moved to the GC mobile app and /cc_status'),
    async execute(interaction) {
        return replyWithCcRedirect(interaction, 'Check Your Progress With /cc_status');
    },
};
