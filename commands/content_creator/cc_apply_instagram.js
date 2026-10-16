'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { replyWithCcRedirect } = require('../../utils/cc_redirect');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('cc-apply-instagram')
        .setDescription('Instagram creator sign-ups moved to the GC mobile app'),
    async execute(interaction) {
        return replyWithCcRedirect(interaction, 'Instagram Sign-Ups Moved to GC Mobile');
    },
};
