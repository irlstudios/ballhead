'use strict';

// Discord exposes no API for embedded activity instances, so a host's presence is
// the only signal that they launched something. The manager ignores every presence
// that is not a host waiting to go live, so this stays cheap on a busy guild.

const { onPresenceUpdate } = require('../utils/host_session_manager');

module.exports = {
    name: 'presenceUpdate',
    async execute(oldPresence, newPresence, client) {
        await onPresenceUpdate(oldPresence, newPresence, client);
    },
};
