'use strict';

// The one surface host_session_manager touches. Every entry point swallows its
// own failures: voice moderation going down must never take session tracking
// with it.

const logger = require('../logger');
const capture = require('./capture');

const onSessionOpen = async ({ channel, session }) => {
    try {
        await capture.joinSession({ channel, session });
    } catch (error) {
        logger.error(`[Voice Mod] Could not start capture for session ${session.id}:`, error);
    }
};

const onSessionClose = async (channelId) => {
    try {
        capture.leaveSession(channelId);
    } catch (error) {
        logger.error(`[Voice Mod] Could not stop capture for channel ${channelId}:`, error);
    }
};

module.exports = { onSessionOpen, onSessionClose };
