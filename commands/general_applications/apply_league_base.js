const { SlashCommandBuilder } = require('@discordjs/builders');
const { createModal } = require('../../modals/modalFactory');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('apply-base-league')
        .setDescription('Apply to register a Base League'),
    async execute(interaction) {
        const level5RoleId = '924522770057031740';
        const higherRoles = [
            '924522921370714152',
            '924522979768016946',
            '924523044268032080',
            '1242262635223715971',
            '925177626644058153',
            '1087071951270453278',
            '1223408044784746656',
        ];

        const userRoles = interaction.member.roles.cache;
        const hasRequiredRole = userRoles.has(level5RoleId) || higherRoles.some(roleId => userRoles.has(roleId));

        if (!hasRequiredRole) {
            return interaction.reply({
                content: 'You need to be at least Level 5 to apply for a Base League.',
                ephemeral: true
            });
        }

        const modal = createModal('apply-base-league-modal');
        if (modal) {
            await interaction.showModal(modal);
        } else {
            await interaction.send.reply({ content: 'Error loading the application form.', ephemeral: true });
        }
    },
};
