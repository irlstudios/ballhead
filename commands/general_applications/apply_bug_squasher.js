const { SlashCommandBuilder } = require('discord.js');
const { createModal } = require('../../modals/modalFactory');
const { noticePayload } = require('../../utils/ui');
const { COMMUNITY_BUG_SQUASHER_ROLE_ID } = require('../../config/constants');

const SUBTITLE = 'Community Bug Squasher Application';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('apply-for-bug-squasher')
        .setDescription('Submit an application to become a Community Bug Squasher'),
    async execute(interaction) {
        const member = await interaction.guild.members.fetch(interaction.user.id);

        if (member.roles.cache.has(COMMUNITY_BUG_SQUASHER_ROLE_ID)) {
            await interaction.reply({
                ...noticePayload(
                    'You are already a Community Bug Squasher and cannot submit another application.',
                    { title: 'Already a Bug Squasher', subtitle: SUBTITLE }
                ),
                ephemeral: true,
            });
            return;
        }

        const modal = createModal('bugSquasherApplicationModal');
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
