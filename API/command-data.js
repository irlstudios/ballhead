const Mixpanel = require('mixpanel');
const logger = require('../utils/logger');
const mixpanel = Mixpanel.init(process.env.MIXPANEL_PROJECT_TOKEN);

async function logCommandUsage(interaction) {
    // Domain commands (/squad invite) need the subcommand in analytics, or
    // every squad action would collapse into one "squad" event.
    const commandName = [
        interaction.commandName,
        interaction.options?.getSubcommandGroup?.(false),
        interaction.options?.getSubcommand?.(false),
    ].filter(Boolean).join(' ');
    const distinctId = interaction.user.id;
    const channelId = interaction.channelId;
    const serverId = interaction.guildId;
    const timestamp = new Date();

    try {
        mixpanel.track('Command Used', {
            distinct_id: String(distinctId),
            command_name: String(commandName),
            channel_id: String(channelId),
            server_id: String(serverId),
            timestamp: timestamp.toISOString(),
        }, (err) => {
            if (err) {
                logger.error('Failed to send command usage to Mixpanel:', err);
            }
        });
    } catch (err) {
        logger.error('Failed to send command usage data:', err);
    }
}

module.exports = logCommandUsage;
