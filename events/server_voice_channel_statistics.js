module.exports = {
    name: 'voiceStateUpdate',
    async execute(oldState, newState, client) {
        if (oldState.channelId !== '960935833676955778'
            && newState.channelId === '960935833676955778') {
            const textChannel = await client.channels.fetch('1278821994925658206');
            await textChannel.send('<@1172224351744049265> it works');
        }
    },
};