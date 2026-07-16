'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { createModal } = require('../../modals/modalFactory');
const { noticePayload } = require('../../utils/ui');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('request-official')
        .setDescription('Request an official for one of your league games (Active/Sponsored leagues)'),
    async execute(interaction) {
        const modal = createModal('request-official-modal');
        if (!modal) {
            return interaction.reply({
                ...noticePayload('Request form unavailable. Try again shortly.', { title: 'Form Unavailable', subtitle: 'Request Official' }),
                ephemeral: true,
            });
        }
        // Eligibility (tier, status, ownership) is validated on modal submit.
        await interaction.showModal(modal);
    },
};
