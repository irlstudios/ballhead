'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { createModal } = require('../../modals/modalFactory');
const { noticePayload } = require('../../utils/ui');
const { fetchLeaguesByOwner } = require('../../db');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('league-checkin')
        .setDescription('Submit your monthly league activity check-in'),

    async execute(interaction) {
        const leagues = await fetchLeaguesByOwner(interaction.user.id);

        if (leagues.length === 0) {
            return interaction.reply({
                ...noticePayload(
                    'You do not own any registered leagues.',
                    { title: 'No League Found', subtitle: 'League Check-in' }
                ),
                ephemeral: true,
            });
        }

        const modal = createModal('league-checkin-modal');
        if (modal) {
            await interaction.showModal(modal);
        } else {
            await interaction.reply({
                ...noticePayload(
                    'Error loading the check-in form.',
                    { title: 'Form Unavailable', subtitle: 'League Check-in' }
                ),
                ephemeral: true,
            });
        }
    },
};
