const {ChannelType} = require('discord-api-types/v10');
module.exports = {
    name: 'messageCreate',
    once: false,
    async execute(message) {
        const sportsEmojis = ['\u26BD', '\u{1F3C0}',  '\u{1F3C8}', '\u26BE', '\u{1F3BE}', '\u{1F3D0}', '\u{1F3C9}', '\u{1F3B1}', '\u{1F3D3}', '\u{1F3F8}', '\u{1F94F}', '\u{1F3D2}', '\u{1F3D1}', '\u{1F94D}', '\u{1F3CF}', '\u{1F633}', '\u{1F631}', '\u{1F44B}', '\u{1F923}', '\u{1F928}', '\u{1F480}'];

        if ((message.content.toLowerCase().includes('ballhead') || message.content.toLowerCase().includes('ball head')) && !message.author.bot) {
            if (message.channel.type === ChannelType.DM) return;
            if (message.channel.id === '1397239932833103894') return;
            const randomEmoji = sportsEmojis[Math.floor(Math.random() * sportsEmojis.length)];
            await message.react(randomEmoji);
        }
    }
};
