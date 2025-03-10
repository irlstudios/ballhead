const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('assignrole')
        .setDescription('Assigns a specified role to all members in another specified role.')
        .addRoleOption(option =>
            option.setName('targetrole')
                .setDescription('The role to assign')
                .setRequired(true))
        .addRoleOption(option =>
            option.setName('baserole')
                .setDescription('The role containing members who will receive the target role')
                .setRequired(true)),

    async execute(interaction) {
        const targetRole = interaction.options.getRole('targetrole');
        const baseRole = interaction.options.getRole('baserole');

        if (!targetRole || !baseRole) {
            return interaction.reply({ content: 'Invalid roles specified.', ephemeral: true });
        }

        await interaction.guild.members.fetch();

        const membersWithBaseRole = interaction.guild.members.cache.filter(member => member.roles.cache.has(baseRole.id));

        if (membersWithBaseRole.size === 0) {
            return interaction.reply({ content: `No members found with the role ${baseRole.name}.`, ephemeral: true });
        }

        let successCount = 0;
        await interaction.deferReply();

        for (const member of membersWithBaseRole.values()) {
            try {
                await member.roles.add(targetRole);
                successCount++;
            } catch (error) {
                console.error(`Failed to assign role to ${member.user.tag}:`, error);
            }
        }

        await interaction.editReply({ content: `Assigned ${targetRole.name} to ${successCount} members with the ${baseRole.name} role.` });
    }
};