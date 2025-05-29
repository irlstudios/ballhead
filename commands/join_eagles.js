// commands/join_eagles.js
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('join_eagles')
        .setDescription('Join the Eagles squad if you’re not already in one.')
        .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),

    async execute(interaction) {
        const member = interaction.member;
        const squadRoles = [
            '1376809095214010529',
            '1365529923619520583'
        ];

        const alreadyInSquad = squadRoles.some(roleId => member.roles.cache.has(roleId));

        if (alreadyInSquad) {
            return interaction.reply({
                content: 'You are already in a squad.',
                ephemeral: true
            });
        }

        try {
            await member.roles.add(squadRoles[0]);
            return interaction.reply('Welcome home eagle!');
        } catch (err) {
            console.error('Failed to add role:', err);
            return interaction.reply({
                content: 'Sorry, I couldn’t add your role. Make sure I have the Manage Roles permission and my role is high enough.',
                ephemeral: true
            });
        }
    }
};