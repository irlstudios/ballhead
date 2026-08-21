'use strict';

// Automatic action on tier 1 hits: server-mute the speaker and apply the VC
// blacklist role (the room system already denies that role Connect and Speak
// in every room). Returns exactly what happened so the alert can show mods
// the outcome; every step fails soft and is reported, never thrown.

const { VC_BLACKLIST_ROLE_ID } = require('../../config/constants');
const { buildEvidenceMessage } = require('./evidence_post');

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

// User-facing wording for each enforcement action. Matched terms are never
// shown to the user; the transcript already carries them and listing trigger
// words only teaches evasion.
const NOTICE_LINES = {
    'server muted': 'You have been muted in voice.',
    'vc blacklist role applied': 'Your access to public voice rooms has been suspended pending staff review.',
};

// DM the enforced user what was detected and what happened to them. Only the
// user's own audio is attached, never the room mix: other participants'
// voices are staff evidence, not something we hand out. Returns whether the
// notice landed so the staff alert can say so; closed DMs fail soft.
const sendEnforcementNotice = async ({ client, userId, actions, transcript, clipWav }) => {
    const lines = actions.map((action) => NOTICE_LINES[action]).filter(Boolean);
    if (lines.length === 0) return { sent: false, reason: 'no action taken, notice skipped' };
    try {
        const user = await client.users.fetch(userId);
        await user.send(buildEvidenceMessage({
            accentColor: 0xE53E3E,
            title: 'Voice Moderation Notice',
            kicker: 'Automated moderation in a public voice room',
            fields: [
                ['What happened', 'Our automated voice moderation flagged language that violates the community guidelines while you were speaking in a public voice room. The incident has been logged for staff review.'],
                ['If you believe this is a mistake', 'This message is not monitored. Please contact a member of the staff team to request a review.'],
            ],
            transcript,
            actionsTaken: lines,
            clipWav,
            fileName: clipWav ? `notice-${Date.now()}.wav` : null,
        }));
        return { sent: true };
    } catch (error) {
        return { sent: false, reason: error?.message || String(error) };
    }
};

module.exports = { applyEnforcement, sendEnforcementNotice };
