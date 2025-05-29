const axios = require('axios');
const Mixpanel = require('mixpanel');
const mixpanel  = Mixpanel.init(process.env.MIXPANEL_PROJECT_TOKEN);

async function logCommandUsage(interaction) {
    const commandData = {
        command_name: interaction.commandName,
        distinct_id: interaction.user.id,
        channel_id: interaction.channelId,
        server_id: interaction.guildId,
        timestamp: new Date()
    };

    try {
        console.log('Metrics logged successfully.');
        mixpanel.track( 'Command Used', {
            distinct_id:   String(commandData.user_id),
            command_name:  String(commandData.command_name),
            channel_id:    String(commandData.channel_id),
            server_id:     String(commandData.server_id),
            timestamp:     commandData.timestamp.toISOString()
        }, (err) => {
            if (err) {
                console.error('Failed to send command usage to Mixpanel:', err);
            }
        });
    } catch (err) {
        console.error('Failed to send command usage data:', err);
    }
}

module.exports = logCommandUsage;