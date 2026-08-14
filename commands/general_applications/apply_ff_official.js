const { SlashCommandBuilder } = require('discord.js');
const { createModal } = require('../../modals/modalFactory');
const { noticePayload } = require('../../utils/ui');
const { FF_OFFICIAL_ELIGIBLE_ROLE_IDS, FF_OFFICIAL_ROLE_ID, FF_APPLICATIONS_PAUSED, FF_APPLICATIONS_PAUSE_MESSAGE } = require('../../config/constants');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('apply-ff-official')
        .setDescription('Submit an application to become an FF Official'),
    async execute(interaction) {
        if (FF_APPLICATIONS_PAUSED) {
            await interaction.reply({
                ...noticePayload(
                    FF_APPLICATIONS_PAUSE_MESSAGE,
                    { title: 'Applications Paused', subtitle: 'FF Official Application' }
                ),
                ephemeral: true,
            });
            return;
        }

        const member = await interaction.guild.members.fetch(interaction.user.id);

        if (member.roles.cache.has(FF_OFFICIAL_ROLE_ID)) {
            await interaction.reply({
                ...noticePayload(
                    'You are already an FF Official and cannot submit another application.',
                    { title: 'Already an FF Official', subtitle: 'FF Official Application' }
                ),
                ephemeral: true,
            });
            return;
        }

        if (!FF_OFFICIAL_ELIGIBLE_ROLE_IDS.some(roleId => member.roles.cache.has(roleId))) {
            await interaction.reply({
                ...noticePayload(
                    'Only Active Officials and Senior Officials can apply to become an FF Official.',
                    { title: 'Role Required', subtitle: 'FF Official Application' }
                ),
                ephemeral: true,
            });
            return;
        }

        const modal = createModal('ffOfficialApplicationModal');
        if (modal) {
            await interaction.showModal(modal);
        } else {
            await interaction.reply({
                ...noticePayload(
                    'Error loading the application form. Please try again soon.',
                    { title: 'Form Unavailable', subtitle: 'FF Official Application' }
                ),
                ephemeral: true,
            });
        }
    }
};
