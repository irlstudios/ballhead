module.exports = {
    name: 'messageCreate',
    once: false,
    async execute(message, client) {
        if (message.author.bot) return;

        const phrases = [
            "can u like my vid", "can you like my vid", "can you guys like my videos",
            "can you guys go like", "i need more likes", "i need likes",
            "can you follow and like", "can you all like", "please like my video",
            "help me get likes", "support my channel"
        ];

        const messageContentLower = message.content.toLowerCase();
        if (phrases.some(phrase => messageContentLower.includes(phrase))) {
            const response = `Hey ${message.author}, if you're struggling to get likes on your videos, the Developers and the rest of the community can help! Post your video in https://discord.com/channels/752216589792706621/1186758799814570084 and we can give you some feedback on how you can get more likes and make your videos the best they can be.`;

            await message.channel.send(response);
        }
    }
};
