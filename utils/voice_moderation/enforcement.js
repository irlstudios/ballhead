'use strict';

// Automatic action on tier 1 hits: server-mute the speaker and apply the VC
// blacklist role (the room system already denies that role Connect and Speak
// in every room). Returns exactly what happened so the alert can show mods
// the outcome; every step fails soft and is reported, never thrown.

const { VC_BLACKLIST_ROLE_ID } = require('../../config/constants');

const applyEnforcement = async ({ guild, userId, reason }) => {
    const actions = [];
    const failures = [];
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return { actions, failures: ['member not found in guild'] };
    if (member.voice?.channel) {
        try {
            await member.voice.setMute(true, reason);
            actions.push('server muted');
        } catch (error) {
            failures.push(`mute failed: ${error?.message || error}`);
        }
    } else {
        failures.push('not in voice, mute skipped');
    }
    try {
        await member.roles.add(VC_BLACKLIST_ROLE_ID, reason);
        actions.push('vc blacklist role applied');
    } catch (error) {
        failures.push(`blacklist failed: ${error?.message || error}`);
    }
    return { actions, failures };
};

module.exports = { applyEnforcement };
