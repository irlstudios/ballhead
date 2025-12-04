const { SlashCommandBuilder } = require('discord.js');
const { createModal } = require('../../modals/modalFactory');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('apply-ko-host')
        .setDescription('Submit an application to become a KO-Host'),
    async execute(interaction) {
        const modal = createModal('koHostApplicationModal');
        if (!modal) {
            await interaction.reply({ content: 'Unable to load the KO-Host application form right now.', ephemeral: true });
            return;
        }

        await interaction.showModal(modal);
    }
};
