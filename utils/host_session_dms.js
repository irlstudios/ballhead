'use strict';

// Host-facing DMs for EMH sessions. The notice builders are pure data so every
// message body is unit testable; sendHostDm owns the only side effect.
//
// These DMs exist because activity detection can fail invisibly: presence is the
// only signal Discord exposes, and a host with activity sharing turned off never
// goes live. The host must hear about that during the session, not after it.

const { ContainerBuilder, MessageFlags } = require('discord.js');
const { buildTextBlock } = require('./ui');
const { summariseSession, trackedMinutes, toMinutes } = require('./host_session_stats');
const logger = require('./logger');

const SUBTITLE = 'EMH Session';

const PRIVACY_STEPS = [
    '- Discord Settings -> Activity Privacy -> **Share your detected activities with others** must be ON. Without it the bot cannot see your activity.',
    '- Launch the activity from inside your lobby voice channel.',
    '- Leaving the lobby ends the session, even for a moment.',
];

const minutesBetween = (from, to) => toMinutes((new Date(to).getTime() - new Date(from).getTime()) / 1000);

const trackingStartedNotice = ({ activityName } = {}) => ({
    title: 'Tracking Started',
    subtitle: SUBTITLE,
    lines: [
        `I detected **${activityName || 'your activity'}** and your session stats are now recording.`,
        'Check in any time with `/room event status`. Leaving the lobby ends the session and I will DM you the wrap-up.',
    ],
});

const noActivityNotice = ({ minutes } = {}) => ({
    title: 'No Activity Detected',
    subtitle: SUBTITLE,
    lines: [
        `Your session opened ${minutes} minutes ago but I have not detected an activity yet, so no stats are being recorded.`,
        '',
        'To fix it:',
        ...PRIVACY_STEPS,
        '',
        'I will DM you the moment tracking starts. `/room event status` shows where things stand.',
    ],
});

const wrapUpNotice = ({ session = {}, summary = {} } = {}) => ({
    title: 'Session Wrap',
    subtitle: SUBTITLE,
    lines: [
        `Your **${session.activityName || 'activity'}** session has ended. Here is how it went:`,
        '',
        `- Tracked time: **${trackedMinutes(session)} min**`,
        `- Unique joiners: **${summary.uniqueJoiners ?? 0}**`,
        `- Total joins: **${summary.totalJoins ?? 0}**`,
        `- Peak in the room with you: **${Number(session.peakConcurrent) || 0}**`,
        `- Average stay: **${summary.avgMinutes ?? 0} min**`,
        `- Total player minutes: **${summary.totalPlayerMinutes ?? 0}**`,
        '',
        'Thanks for hosting.',
    ],
});

const endedWithoutTrackingNotice = () => ({
    title: 'Session Ended Without Tracking',
    subtitle: SUBTITLE,
    lines: [
        'Your session ended before I ever detected an activity, so no stats were recorded.',
        '',
        'If you did run one, the usual causes:',
        ...PRIVACY_STEPS,
        '',
        'Next time I will DM you the moment tracking starts, so no DM means the activity is not being detected.',
    ],
});

const statusNotice = ({ session = {}, members = [], currentParticipants = 0, now = new Date() } = {}) => {
    if (!session.activityStartedAt) {
        return {
            title: 'Session Status',
            subtitle: SUBTITLE,
            lines: [
                `Your session opened ${minutesBetween(session.startedAt, now)} min ago and is **waiting for an activity**. No stats are being recorded yet.`,
                '',
                'If you already launched one:',
                ...PRIVACY_STEPS,
            ],
        };
    }
    const summary = summariseSession({ members, hostId: session.hostId });
    return {
        title: 'Session Status',
        subtitle: SUBTITLE,
        lines: [
            `**${session.activityName || 'Activity'}** is live and recording.`,
            '',
            `- Tracked so far: **${trackedMinutes({ activityStartedAt: session.activityStartedAt, endedAt: now })} min**`,
            `- Unique joiners so far: **${summary.uniqueJoiners}**`,
            // Null means the room could not be inspected, which is not the same
            // as an empty room, so the line is dropped rather than showing 0.
            ...(currentParticipants === null ? [] : [`- In the room with you now: **${currentParticipants}**`]),
            `- Peak in the room with you: **${Number(session.peakConcurrent) || 0}**`,
            '',
            'Leaving the lobby ends the session and I will DM you the wrap-up.',
        ],
    };
};

// Hosts can have DMs closed; a failed DM must never break the session lifecycle.
const sendHostDm = async (client, hostId, notice) => {
    try {
        const user = await client.users.fetch(String(hostId));
        const container = new ContainerBuilder();
        const block = buildTextBlock(notice);
        if (block) container.addTextDisplayComponents(block);
        await user.send({ flags: MessageFlags.IsComponentsV2, components: [container] });
        return true;
    } catch (error) {
        logger.error(`[Host Session] Failed to DM host ${hostId}:`, error.message);
        return false;
    }
};

module.exports = {
    trackingStartedNotice,
    noActivityNotice,
    wrapUpNotice,
    endedWithoutTrackingNotice,
    statusNotice,
    sendHostDm,
};
