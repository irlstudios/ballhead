const { Client, Message } = require('discord.js');
const axios = require('axios');

module.exports = {
    name: 'messageCreate',
    once: false,
    async execute(message, client) {
        const sportsEmojis = ['⚽', '🏀',  '🏈', '⚾', '🎾', '🏐', '🏉', '🎱', '🏓', '🏸', '🥏', '🏒', '🏑', '🥍', '🏏', '😳', '😱', '👋', '🤣', '🤨', '💀'];

        if ((message.content.toLowerCase().includes('ballhead') || message.content.toLowerCase().includes('ball head')) && !message.author.bot) {
            const randomEmoji = sportsEmojis[Math.floor(Math.random() * sportsEmojis.length)];
            try {
                await message.react(randomEmoji);

                const logData = {
                    command_name: "Ballhead",
                    user_id: message.author.id,
                    channel_id: message.channelId,
                    server_id: message.guildId,
                    timestamp: new Date(),
                };

                await axios.post('https://lyjm699n1i.execute-api.us-east-2.amazonaws.com/dev/meticHandlers/commands', logData)
                    .catch(err => {
                        console.error('Failed to send data:', err);
                    });

            } catch (error) {
                console.error(`Could not react to message: ${error}`);
            }
        }
    }
};