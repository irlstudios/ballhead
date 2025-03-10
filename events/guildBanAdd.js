const { Events, EmbedBuilder } = require('discord.js');

module.exports = {
    name: Events.GuildBanAdd,
    async execute(ban) {
        console.log(`guildBanAdd event triggered for user: ${ban.user.tag} in guild: ${ban.guild.name}`);

        const { user, guild, reason } = ban;
        const logChannelId = '828618109794385970';
        let logChannel;

        try {
            logChannel = await guild.channels.fetch(logChannelId);
        } catch (error) {
            console.error(`Could not fetch log channel: ${error.message}`);
            return;
        }

        const banReason = reason || 'No reason provided';
        const dmEmbed = new EmbedBuilder()
            .setTitle('You have been banned')
            .setDescription(`Hello ${user.username}, you have been banned from ${guild.name} by a moderator due to ${banReason}. If you wish to appeal, please message support@gymclassvr.com and/or fill out this form: [Appeal Form](https://forms.gle/neDffHLRg9kjcWbs6)`)
            .setColor(0xFF0000);

        const logEmbed = new EmbedBuilder().setColor(0xFF0000);

        try {
            await user.send({ embeds: [dmEmbed] });
            logEmbed
                .setTitle('Ban Notification Sent')
                .setDescription(`Successfully notified ${user.id} about their ban and how to appeal`);
            console.log(`Successfully sent ban notification to ${user.tag}`);
        } catch (error) {
            logEmbed
                .setTitle('Ban Notification Failed')
                .setDescription(`Was not able to message ${user.id} about their ban. Error: ${error.message}`);
            console.error(`Failed to send ban notification to ${user.tag}: ${error.message}`);
        }

        try {
            await logChannel.send({ embeds: [logEmbed] });
            console.log(`Logged ban notification status to channel ${logChannelId}`);
        } catch (error) {
            console.error(`Failed to send log message to channel ${logChannelId}: ${error.message}`);
        }
    },
};
