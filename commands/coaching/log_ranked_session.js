const { SlashCommandBuilder } = require('discord.js');
const { createModal } = require('../../modals/modalFactory');

const RANKED_COACH_ROLES = [
    '1273704152777883698',
    '1419458741006499961',
    '1312965840974643320',
    '1378911501712363701',
    '981933984453890059',
    '1317633044286406729',
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('log-ranked-session')
        .setDescription('Log a ranked coaching session'),
    async execute(interaction) {
        const hasRole = interaction.member?.roles?.cache?.some(role => RANKED_COACH_ROLES.includes(role.id));
        if (!hasRole) {
            await interaction.reply({ content: 'You do not have permission to log ranked sessions.', ephemeral: true });
            return;
        }

        const modal = createModal('rankedSessionModal');
        if (!modal) {
            await interaction.reply({ content: 'Unable to load the ranked session form right now.', ephemeral: true });
            return;
        }

        await interaction.showModal(modal);
    }
};
