const { Events, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');

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
        const dmContainer = new ContainerBuilder();
        dmContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent('## You have been banned'));
        dmContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent([
            `Hello ${user.username}, you have been banned by a moderator.`,
            `**Reason:** ${banReason}`,
            'If you wish to appeal, please message support@gymclassvr.com or use the appeal form:',
            'https://forms.gle/neDffHLRg9kjcWbs6'
        ].join('\n')));
        dmContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent('-# Appeals handled by Gym Class VR'));

        let logContainer = new ContainerBuilder();

        try {
            await user.send({ flags: MessageFlags.IsComponentsV2, components: [dmContainer] });
            logContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent('## Ban Notification Sent'));
            logContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(`Successfully notified ${user.id} about their ban and appeal options.`));
            console.log(`Successfully sent ban notification to ${user.tag}`);
        } catch (error) {
            logContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent('## Ban Notification Failed'));
            logContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(`Was not able to message ${user.id}. Error: ${error.message}`));
            console.error(`Failed to send ban notification to ${user.tag}: ${error.message}`);
        }

        try {
            await logChannel.send({ flags: MessageFlags.IsComponentsV2, components: [logContainer] });
            console.log(`Logged ban notification status to channel ${logChannelId}`);
        } catch (error) {
            console.error(`Failed to send log message to channel ${logChannelId}: ${error.message}`);
        }
    },
};
