const Mixpanel = require('mixpanel');
const mixpanel = Mixpanel.init(process.env.MIXPANEL_PROJECT_TOKEN);

module.exports = {
    name: 'voiceStateUpdate',
    async execute(oldState, newState) {
        if (
            oldState.channelId !== '960935833676955778' &&
            newState.channelId === '960935833676955778'
        ) {
            mixpanel.track('Stage Join', {
                stage_id: String(newState.channelId),
                user_id: String(newState.member.id),
                date: new Date().toISOString(),
            });
        }
    },
};