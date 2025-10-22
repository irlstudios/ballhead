const {ChannelType} = require('discord-api-types/v10');
module.exports = {
    name: 'messageCreate',
    once: false,
    async execute(message) {
        const sportsEmojis = ['⚽', '🏀',  '🏈', '⚾', '🎾', '🏐', '🏉', '🎱', '🏓', '🏸', '🥏', '🏒', '🏑', '🥍', '🏏', '😳', '😱', '👋', '🤣', '🤨', '💀'];

        if ((message.content.toLowerCase().includes('ballhead') || message.content.toLowerCase().includes('ball head')) && !message.author.bot) {
            if (message.channel.type === ChannelType.DM) return;
            if (message.channel.id === '1397239932833103894') return;
            const randomEmoji = sportsEmojis[Math.floor(Math.random() * sportsEmojis.length)];
            await message.react(randomEmoji);
        }
    }
};
