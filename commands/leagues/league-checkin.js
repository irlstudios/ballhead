'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { createModal } = require('../../modals/modalFactory');
const { noticePayload } = require('../../utils/ui');
const { fetchLeaguesByOwner, fetchLeaguesByCoOwner } = require('../../db');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('league-checkin')
        .setDescription('Submit your monthly league activity check-in'),

    async execute(interaction) {
        const userId = interaction.user.id;
        const ownedLeagues = await fetchLeaguesByOwner(userId);
        const coOwnedLeagues = await fetchLeaguesByCoOwner(userId);

        if (ownedLeagues.length === 0 && coOwnedLeagues.length === 0) {
            return interaction.reply({
                ...noticePayload(
                    'You do not own or co-own any registered leagues.',
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
