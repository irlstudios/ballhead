const logger = require('../utils/logger');
const mixpanel = require('../utils/mixpanel');
const { insertAnalyticsEvent } = require('../db');

// Domain commands (/squad invite) need the subcommand in analytics, or
// every squad action would collapse into one "squad" event.
const buildCommandName = (interaction) => [
    interaction.commandName,
    interaction.options?.getSubcommandGroup?.(false),
    interaction.options?.getSubcommand?.(false),
].filter(Boolean).join(' ');

async function logCommandUsage(interaction) {
    const commandName = buildCommandName(interaction);
    const properties = {
        command_name: String(commandName),
        channel_id: String(interaction.channelId),
        server_id: String(interaction.guildId),
    };
    const distinctId = String(interaction.user.id);

    try {
        if (mixpanel) {
            mixpanel.track('Command Used', {
                distinct_id: distinctId,
                ...properties,
                timestamp: new Date().toISOString(),
            }, (err) => {
                if (err) {
                    logger.error('Failed to send command usage to Mixpanel:', err);
                }
            });
        }
    } catch (err) {
        logger.error('Failed to send command usage data:', err);
    }

    try {
        await insertAnalyticsEvent('Command Used', distinctId, properties);
    } catch (err) {
        logger.error('Failed to store command usage locally:', err);
    }
}

module.exports = { logCommandUsage, buildCommandName };
