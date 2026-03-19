const Mixpanel = require('mixpanel');
const logger = require('../utils/logger');
const mixpanel = Mixpanel.init(process.env.MIXPANEL_PROJECT_TOKEN);

async function logCommandUsage(interaction) {
    const commandName = interaction.commandName;
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
