const logger = require('../utils/logger');
const mixpanel = require('../utils/mixpanel');
const { insertAnalyticsEvent } = require('../db');

module.exports = {
    name: 'voiceStateUpdate',
    async execute(oldState, newState) {
        if (
            oldState.channelId !== '960935833676955778' &&
            newState.channelId === '960935833676955778'
        ) {
            try {
                if (mixpanel) {
                    mixpanel.track('Stage Join', {
                        stage_id: String(newState.channelId),
                        distinct_id: String(newState.member.id),
                        date: new Date().toISOString(),
                    });
                }
            } catch (err) {
                logger.error('Failed to send stage join to Mixpanel:', err);
            }
            try {
                await insertAnalyticsEvent('Stage Join', newState.member.id, {
                    stage_id: String(newState.channelId),
                });
            } catch (err) {
                logger.error('Failed to store stage join locally:', err);
            }
        }
    },
};
