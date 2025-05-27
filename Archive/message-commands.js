const { EmbedBuilder } = require('discord.js');
require('dotenv').config({ path: './resources/.env' });

module.exports = {
    name: 'messageCreate',
    async execute(message) {
        const prefix = process.env.BOT_PREFIX;
        if (!prefix) {
            console.error('The bot prefix is not defined in the .env file.');
            return;
        }
        if (message.author.bot || !message.content.startsWith(prefix)) return;

        const args = message.content.slice(prefix.length).trim().split(/ +/);
        const command = args.shift()?.toLowerCase();

        if (command === 'contest') {
            const mainEmbed = new EmbedBuilder()
                .setTitle('Sorry!')
                .setDescription(`At the moment, there are currently no contests running. Check back soon!`)
            await message.channel.send({
                embeds: [mainEmbed],
            });
        }
    },
};