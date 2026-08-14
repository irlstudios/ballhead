const { SlashCommandBuilder } = require('discord.js');
const { createModal } = require('../../modals/modalFactory');
const { noticePayload } = require('../../utils/ui');
const { HOST_ROLE_ID } = require('../../config/constants');

const SUBTITLE = 'EMH Application';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('apply-emh')
        .setDescription('Submit an application to become an EMH (Extra Modes Host)'),
    async execute(interaction) {
        const member = await interaction.guild.members.fetch(interaction.user.id);

        if (member.roles.cache.has(HOST_ROLE_ID)) {
            await interaction.reply({
                ...noticePayload(
                    'You are already an EMH and cannot submit another application.',
                    { title: 'Already an EMH', subtitle: SUBTITLE }
                ),
                ephemeral: true,
            });
            return;
        }

        const modal = createModal('emhApplicationModal');
        if (modal) {
            await interaction.showModal(modal);
        } else {
            await interaction.reply({
                ...noticePayload(
                    'Error loading the application form. Please try again soon.',
                    { title: 'Form Unavailable', subtitle: SUBTITLE }
                ),
                ephemeral: true,
            });
        }
    }
};
