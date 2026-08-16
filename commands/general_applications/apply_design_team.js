const { SlashCommandBuilder } = require('discord.js');
const { createModal } = require('../../modals/modalFactory');
const { noticePayload } = require('../../utils/ui');
const { MAKES_COOL_THINGS_ROLE_ID } = require('../../config/constants');

const SUBTITLE = 'Community Design Team Application';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('apply-cdt')
        .setDescription('Submit an application to join the Community Design Team (CDT)'),
    async execute(interaction) {
        const member = await interaction.guild.members.fetch(interaction.user.id);

        if (member.roles.cache.has(MAKES_COOL_THINGS_ROLE_ID)) {
            await interaction.reply({
                ...noticePayload(
                    'You are already a Community Design Team member and cannot submit another application.',
                    { title: 'Already a Team Member', subtitle: SUBTITLE }
                ),
                ephemeral: true,
            });
            return;
        }

        const modal = createModal('communityDesignerApplicationModal');
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
