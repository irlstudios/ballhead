const { SlashCommandBuilder } = require('discord.js');
const { createModal } = require('../../modals/modalFactory');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('apply-for-official')
        .setDescription('Submit an application to become an official'),
    async execute(interaction) {
        const levelRoles = [
            '924522770057031740',
            '924522921370714152',
            '924522979768016946',
            '924523044268032080',
            '1242262635223715971',
            '1087071951270453278',
            '1223408044784746656'
        ];

        const member = await interaction.guild.members.fetch(interaction.user.id);

        if (!levelRoles.some(roleId => member.roles.cache.has(roleId))) {
            await interaction.reply({
                content: 'You must have <@&924522770057031740>+ to apply for official',
                ephemeral: true,
            });
            return;
        }

        const modal = createModal('officialApplicationModal');
        if (modal) {
            await interaction.showModal(modal);
        } else {
            await interaction.reply({ content: 'Error loading the application form.', ephemeral: true });
        }
    }
};