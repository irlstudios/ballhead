const {SlashCommandBuilder, EmbedBuilder} = require('discord.js');
const axios = require('axios');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rep')
        .setDescription('Give reputation to a user for a specific message')
        .addUserOption(option => option.setName('user').setDescription('The user to give rep to').setRequired(true))
        .addStringOption(option => option.setName('message-link').setDescription('The message link').setRequired(true)),

    async execute(interaction) {
        const allowedRoles = [
            '978129063724085249',
            '805833778064130104',
            '939634611909185646',
            '1130151149798948974'
        ];
        const member = interaction.member;

        const hasAllowedRole = allowedRoles.some(roleId => member.roles.cache.has(roleId));
        if (!hasAllowedRole) {
            return interaction.reply({content: 'You do not have permission to give Rep.', ephemeral: true});
        }

        const user = interaction.options.getUser('user');
        const messageLink = interaction.options.getString('message-link');

        const parts = messageLink.split('/');
        const channelId = parts[parts.length - 2];
        const messageId = parts.pop();

        try {
            const channel = await interaction.client.channels.fetch(channelId);
            if (!channel) {
                return interaction.reply({content: 'Could not find highlights channel', ephemeral: true});
            }

            const message = await channel.messages.fetch(messageId);
            if (!message) {
                return interaction.reply({
                    content: 'User message could not be found, ensure you provide a correct link.',
                    ephemeral: true
                });
            }

            await axios.post('http://localhost:3000/api/reputation', {
                user_id: user.id,
            });

            const dmEmbed = new EmbedBuilder()
                .setColor(0x00ff00)
                .setTitle('You Received Rep!')
                .setDescription(`You received Rep for your message in the **${interaction.guild.name}** server!`)
                .addFields({name: 'Message Content', value: message.content || '*No content*'})
                .setFooter({text: `${interaction.guild.name} Rep System`})
                .setTimestamp();

            await user.send({embeds: [dmEmbed]}).catch(console.error);

            const embed = new EmbedBuilder()
                .setColor(0x00ff00)
                .setTitle('🌟 Rep Given!')
                .setDescription(`${user.tag} has received Rep for their message! 🎉`)
                .addFields(
                    {name: 'Message Content', value: message.content || '*No content*'},
                    {name: 'Given by', value: interaction.user.tag}
                )
                .setThumbnail(user.displayAvatarURL({dynamic: true}))
                .setFooter({text: `${interaction.guild.name} Rep System`})
                .setTimestamp();

            const repChannel = interaction.client.channels.cache.get('1273577142831153203');
            if (repChannel) {
                await repChannel.send({embeds: [embed]});
            }

            await interaction.reply({content: 'Rep given successfully!', ephemeral: true});
        } catch (error) {
            console.error('Error handling the rep command:', error);
            await interaction.reply({content: 'Failed to give Rep. Please try again later.', ephemeral: true});
        }
    },
};
