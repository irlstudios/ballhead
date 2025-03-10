const axios = require('axios');

async function logCommandUsage(interaction) {
    const commandData = {
        command_name: interaction.commandName,
        user_id: interaction.user.id,
        channel_id: interaction.channelId,
        server_id: interaction.guildId,
        timestamp: new Date()
    };

    try {
        await axios.post('https://lyjm699n1i.execute-api.us-east-2.amazonaws.com/dev/meticHandlers/commands', commandData);
        console.log('Metrics logged successfully.');
    } catch (err) {
        console.error('Failed to send command usage data:', err);
    }
}

module.exports = logCommandUsage;