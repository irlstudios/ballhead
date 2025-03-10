const {SlashCommandBuilder, EmbedBuilder} = require('discord.js');
const axios = require('axios');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('remove-rep')
        .setDescription('Remove reputation from a user')
        .addUserOption(option => option.setName('user').setDescription('The user to remove rep from').setRequired(true))
        .addIntegerOption(option => option.setName('amount').setDescription('The amount of rep to remove').setRequired(true)),

    async execute(interaction) {
        const allowedRoles = ['978129063724085249', '805833778064130104'];
        const member = interaction.member;

        const hasAllowedRole = allowedRoles.some(roleId => member.roles.cache.has(roleId));
        if (!hasAllowedRole) {
            return interaction.reply({content: 'You do not have permission to remove Rep.', ephemeral: true});
        }

        const user = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');

        if (amount <= 0) {
            return interaction.reply({content: 'Please specify a positive number for the amount.', ephemeral: true});
        }

        try {
            await axios.post('http://localhost:3000/api/reputation/remove', {
                user_id: user.id,
                amount: amount,
            });

            const dmEmbed = new EmbedBuilder()
                .setColor(0xff0000)
                .setTitle('Reputation Removed')
                .setDescription(`You have lost ${amount} Rep in the **${interaction.guild.name}** server.`)
                .setFooter({text: `Removed by ${interaction.user.tag}`})
                .setTimestamp();

            await user.send({embeds: [dmEmbed]}).catch(console.error);

            const embed = new EmbedBuilder()
                .setColor(0xff0000)
                .setTitle('⚠️ Rep Removed')
                .setDescription(`${user.tag} has lost ${amount} Rep.`)
                .addFields(
                    {name: 'Rep Removed by', value: interaction.user.tag}
                )
                .setThumbnail(user.displayAvatarURL({dynamic: true}))
                .setFooter({text: `Ensure that your contributions are constructive.`})
                .setTimestamp();

            const targetGuildId = '1233740086839869501';
            const targetChannelId = '1233853415952748645';
            const guild = await interaction.client.guilds.fetch(targetGuildId);
            const channel = guild.channels.cache.get(targetChannelId);

            if (channel) {
                await channel.send({embeds: [embed]});
            } else {
                console.error('Channel not found');
            }

            await interaction.reply({content: 'Rep removed successfully.', ephemeral: true});
        } catch (error) {
            console.error('Error removing reputation via API:', error);
            await interaction.reply({content: 'Failed to remove Rep. Please try again later.', ephemeral: true});
        }
    },
};
