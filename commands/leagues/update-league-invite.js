'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { createModal } = require('../../modals/modalFactory');
const { noticePayload } = require('../../utils/ui');
const { fetchLeaguesByOwner, fetchLeaguesByCoOwner } = require('../../db');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('update-league-invite')
        .setDescription('Update the invite link for your league'),

    async execute(interaction) {
        const userId = interaction.user.id;
        const ownedLeagues = await fetchLeaguesByOwner(userId);
        const coOwnedLeagues = await fetchLeaguesByCoOwner(userId);

        if (ownedLeagues.length === 0 && coOwnedLeagues.length === 0) {
            return interaction.reply({
                ...noticePayload(
                    'You do not own or co-own any registered leagues.',
                    { title: 'No League Found', subtitle: 'Update Invite' }
                ),
                ephemeral: true,
            });
        }

        const modal = createModal('update-league-invite-modal');
        if (modal) {
            await interaction.showModal(modal);
        } else {
            await interaction.reply({
                ...noticePayload(
                    'Error loading the invite update form.',
                    { title: 'Form Unavailable', subtitle: 'Update Invite' }
                ),
                ephemeral: true,
            });
        }
    },
};
