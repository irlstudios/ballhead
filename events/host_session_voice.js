'use strict';

// Join and leave tracking for live event sessions. Registered separately from the
// personal-room system, which deletes the room the moment the host leaves: session
// stats are closed out from stored state rather than from the channel, so it does
// not matter which listener wins that race.

const { onVoiceStateUpdate } = require('../utils/host_session_manager');

module.exports = {
    name: 'voiceStateUpdate',
    async execute(oldState, newState, client) {
        await onVoiceStateUpdate(oldState, newState, client);
    },
};
