const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('managerole')
        .setDescription('Removes a specified role from a specified user.')
        .addUserOption(option =>
            option.setName('target')
                .setDescription('The user to remove the role from')
                .setRequired(true))
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('The role to remove')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('action')
                .setDescription('Choose whether to add or remove the role')
                .setRequired(true)
                .addChoices(
                    { name: 'add', value: 'add' },
                    { name: 'remove', value: 'remove' }
                )),

    async execute(interaction) {
        if (interaction.user.id !== '781397829808553994') {
            return interaction.reply({
                content: "You don't have permission to use this command.",
                ephemeral: true
            });
        }

        const action = interaction.options.getString('action');
        const targetUser = interaction.options.getUser('target');
        const role = interaction.options.getRole('role');
        const guildMember = interaction.guild.members.cache.get(targetUser.id);

        if (!guildMember) {
            return interaction.reply({
                content: 'The specified user is not in this server.',
                ephemeral: true
            });
        }

        if (action === 'add') {
            if (guildMember.roles.cache.has(role.id)) {
                return interaction.reply({
                    content: `${targetUser.username} already has the role ${role.name}.`,
                    ephemeral: true
                });
            }
            try {
                await guildMember.roles.add(role);
                return interaction.reply({
                    content: `Successfully added the role ${role.name} to ${targetUser.username}.`,
                    ephemeral: true
                });
            } catch (error) {
                console.error(error);
                return interaction.reply({
                    content: `Failed to add the role. Please check my permissions and try again.`,
                    ephemeral: true
                });
            }
        } else if (action === 'remove') {
            if (!guildMember.roles.cache.has(role.id)) {
                return interaction.reply({
                    content: `${targetUser.username} does not have the role ${role.name}.`,
                    ephemeral: true
                });
            }
            try {
                await guildMember.roles.remove(role);
                return interaction.reply({
                    content: `Successfully removed the role ${role.name} from ${targetUser.username}.`,
                    ephemeral: true
                });
            } catch (error) {
                console.error(error);
                return interaction.reply({
                    content: `Failed to remove the role. Please check my permissions and try again.`,
                    ephemeral: true
                });
            }
        } else {
            return interaction.reply({
                content: `Invalid action specified.`,
                ephemeral: true
            });
        }
    }
};