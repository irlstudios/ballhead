const { EmbedBuilder } = require('discord.js');
const { updateUserReputation } = require('../db');

module.exports = {
    name: 'messageReactionAdd',
    async execute(reaction, user, client) {
        if (user.bot) return;
        if (reaction.emoji.name !== '➕') return;
        if (reaction.partial) {
            try {
                await reaction.fetch();
            } catch (error) {
                console.error('Something went wrong when fetching the reaction:', error);
                return;
            }
        }

        const allowedRoles = [
            '978129063724085249',
            '805833778064130104',
            '939634611909185646',
            '1130151149798948974'
        ];
        const guild = reaction.message.guild;
        const reactor = guild.members.cache.get(user.id);

        const hasAllowedRole = allowedRoles.some(roleId => reactor.roles.cache.has(roleId));
        if (!hasAllowedRole) return;

        const messageAuthor = reaction.message.author;
        if (messageAuthor.bot) return;

        const messageContent = reaction.message.content || '*No content*';

        try {
            await updateUserReputation(messageAuthor.id)

            const dmEmbed = new EmbedBuilder()
                .setColor(0x00ff00)
                .setTitle('You Received Rep!')
                .setDescription(`${user.tag} appreciated your feedback and gave you Rep in the **${guild.name}** server!`)
                .addFields({ name: 'Message Content', value: messageContent })
                .setFooter({ text: `${interaction.guild.name} Rep System` })
                .setTimestamp();

            await messageAuthor.send({ embeds: [dmEmbed] }).catch(console.error);

            const embed = new EmbedBuilder()
                .setColor(0x00ff00)
                .setTitle('🌟 Rep Given!')
                .setDescription(`${user.tag} has received Rep for their message! 🎉`)
                .addFields(
                    { name: 'Message Content', value: message.content || '*No content*' },
                    { name: 'Given by', value: interaction.user.tag }
                )
                .setThumbnail(user.displayAvatarURL({ dynamic: true }))
                .setFooter({ text: `${interaction.guild.name} Rep System` })
                .setTimestamp();

            const repChannel = client.channels.cache.get('1273577142831153203');
            if (repChannel) {
                await repChannel.send({ embeds: [embed] });
            }
        } catch (error) {
            console.error('Error updating reputation:', error);
        }
    },
};
