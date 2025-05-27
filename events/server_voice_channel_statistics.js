const Mixpanel = require('mixpanel');
const mixpanel = Mixpanel.init(process.env.MIXPANEL_TOKEN);

module.exports = {
    name: 'voiceStateUpdate',
    async execute(oldState, newState, client) {
        if (
            oldState.channelId !== '960935833676955778' &&
            newState.channelId === '960935833676955778'
        ) {
            mixpanel.track('Stage Join', {
                stage_id: newState.channelId,
                user_id: newState.member.id,
                date: Date.now(),
            });
        }
    },
};