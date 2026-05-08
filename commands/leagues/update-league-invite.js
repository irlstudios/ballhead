'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { createModal } = require('../../modals/modalFactory');
const { noticePayload } = require('../../utils/ui');
const { fetchLeaguesByOwner } = require('../../db');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('update-league-invite')
        .setDescription('Update the invite link for your league'),

    async execute(interaction) {
        const leagues = await fetchLeaguesByOwner(interaction.user.id);

        if (leagues.length === 0) {
            return interaction.reply({
                ...noticePayload(
                    'You do not own any registered leagues.',
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
