'use strict';

// Runtime for host EMH sessions: opens the room up for Discord activities, waits
// for the host to launch one, tracks who came and how long they stayed, nudges
// general chat while it runs, and writes one row to the sheet when the host leaves.
//
// The database is the source of truth; the maps below are only an index so the
// voice and presence listeners can ignore unrelated events without a query.

const { ActivityType } = require('discord.js');
const logger = require('./logger');
const store = require('./host_session_queries');
const { appendSessionRow } = require('./host_session_sheet');
const { eventChannelName, summariseSession, nudgeMessage } = require('./host_session_stats');
const {
    GYM_CLASS_GENERAL_CHANNEL_ID,
    HOST_SESSION_NUDGE_MINUTES,
    VC_ACTIVITY_ALLOWED_ROLE_IDS,
} = require('../config/constants');

// Custom status (4), Spotify (2) and go-live (1) are not the host starting
// something to play, so they must not flip a session live.
const ACTIVITY_TYPES = new Set([ActivityType.Playing, ActivityType.Watching, ActivityType.Competing]);

const sessionsByChannel = new Map();
const pendingByHost = new Map();
const nudgeTimers = new Map();
// Sessions that have begun finishing. A host whose activity appears in the same
// tick they leave would otherwise let an in-flight goLive re-index the session and
// leave a nudge timer posting about a room that no longer exists.
const finishing = new Set();

const isTrackedActivity = (activity) => ACTIVITY_TYPES.has(activity?.type) && Boolean(activity?.name);

const getSessionByChannel = (channelId) => sessionsByChannel.get(channelId) || null;

const indexSession = (session) => {
    sessionsByChannel.set(session.channelId, session);
    if (session.activityStartedAt) {
        pendingByHost.delete(session.hostId);
    } else {
        pendingByHost.set(session.hostId, session);
    }
};

const forgetSession = (session) => {
    sessionsByChannel.delete(session.channelId);
    pendingByHost.delete(session.hostId);
    const timer = nudgeTimers.get(session.id);
    if (timer) {
        clearInterval(timer);
        nudgeTimers.delete(session.id);
    }
};

const countParticipants = (channel, hostId) => (channel?.members
    ? channel.members.filter((member) => !member.user.bot && member.id !== hostId).size
    : 0);

// Opening the room: everyone may launch activities, and the host loses the
// ManageChannels overwrite the personal-room system granted them so they cannot
// rename or lock the room out from under an event that is being advertised.
const openRoomForActivities = async (channel, hostId) => {
    // UseExternalApps rides along with UseEmbeddedActivities: launching an
    // activity whose app is not installed to the server requires it, and
    // Discord rejects the launch without it even when Use Activities is allowed.
    await channel.permissionOverwrites.edit(channel.guild.roles.everyone, {
        UseEmbeddedActivities: true,
        UseExternalApps: true,
        Connect: true,
    });
    await channel.permissionOverwrites.edit(hostId, {
        UseEmbeddedActivities: true,
        UseExternalApps: true,
        ManageChannels: false,
    });
};

const restoreRoom = async (channel, session) => {
    if (!channel) return;
    // UseExternalApps: null removes the overwrite rather than pinning a deny,
    // so staff roles with the guild-level permission keep it in idle rooms.
    await channel.permissionOverwrites.edit(channel.guild.roles.everyone, {
        UseEmbeddedActivities: false,
        UseExternalApps: null,
    }).catch(() => {});
    const hostMember = await channel.guild.members.fetch(session.hostId).catch(() => null);
    const hostKeepsActivities = Boolean(hostMember?.roles.cache.some((role) => VC_ACTIVITY_ALLOWED_ROLE_IDS.has(role.id)));
    await channel.permissionOverwrites.edit(session.hostId, {
        UseEmbeddedActivities: hostKeepsActivities,
        UseExternalApps: hostKeepsActivities ? true : null,
        ManageChannels: true,
    }).catch(() => {});
    if (session.originalName && channel.name !== session.originalName) {
        await channel.setName(session.originalName).catch(() => {});
    }
};

// The previous nudge is deleted before the next one posts so a three-hour event
// leaves one live message in general rather than a column of stale ones.
const postNudge = async (client, session) => {
    try {
        const general = await client.channels.fetch(GYM_CLASS_GENERAL_CHANNEL_ID).catch(() => null);
        if (!general?.isTextBased?.()) return;

        if (session.nudgeMessageId) {
            await general.messages.delete(session.nudgeMessageId).catch(() => {});
        }
        const sent = await general.send({
            content: nudgeMessage({
                guildId: session.guildId,
                channelId: session.channelId,
                hostId: session.hostId,
                activityName: session.activityName,
            }),
            allowedMentions: { users: [session.hostId] },
        });
        const updated = { ...session, nudgeMessageId: sent.id };
        indexSession(updated);
        await store.setNudgeMessageId(session.id, sent.id);
    } catch (error) {
        logger.error(`[Host Session] Failed to nudge general chat for session ${session.id}:`, error);
    }
};

const startNudgeLoop = (client, session) => {
    if (nudgeTimers.has(session.id)) return;
    const intervalMs = Math.max(1, HOST_SESSION_NUDGE_MINUTES) * 60 * 1000;
    const timer = setInterval(() => {
        const current = sessionsByChannel.get(session.channelId);
        if (!current || current.id !== session.id) {
            clearInterval(timer);
            nudgeTimers.delete(session.id);
            return;
        }
        void postNudge(client, current);
    }, intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
    nudgeTimers.set(session.id, timer);
};

// Called once the host's first activity appears. Everyone already sitting in the
// room is credited from this moment: they were waiting for the event to start,
// not playing, so their clock starts with the activity.
const goLive = async (client, session, activityName) => {
    if (finishing.has(session.id)) return;
    const live = await store.markSessionLive({ sessionId: session.id, activityName });
    if (!live || finishing.has(live.id)) return;
    indexSession(live);

    const channel = await client.channels.fetch(live.channelId).catch(() => null);
    if (channel?.members) {
        const present = channel.members.filter((member) => !member.user.bot);
        for (const member of present.values()) {
            await store.openMemberInterval({ sessionId: live.id, userId: member.id });
        }
        // Anyone who left while the loop above was awaiting would have had their
        // close land on a member row that did not exist yet, so reconcile against
        // the room as it stands now rather than the snapshot taken above.
        await store.closeMemberIntervalsExcept({
            sessionId: live.id,
            presentUserIds: channel.members.filter((member) => !member.user.bot).map((member) => member.id),
        });
        await store.recordPeakConcurrent(live.id, countParticipants(channel, live.hostId));
    }

    if (finishing.has(live.id)) return;
    logger.info(`[Host Session] Session ${live.id} is live: ${live.hostName} playing ${activityName}.`);
    await postNudge(client, sessionsByChannel.get(live.channelId) || live);
    startNudgeLoop(client, live);
};

// Writes the session's row and records that it landed, so a Sheets outage leaves
// a retryable session rather than losing the event.
const publishSession = async (session) => {
    const members = await store.listSessionMembers(session.id);
    const summary = summariseSession({ members, hostId: session.hostId });
    if (await appendSessionRow({ session, summary })) {
        await store.markSheetWritten(session.id);
    }
    return summary;
};

const finishSession = async (client, session, { channel = null } = {}) => {
    const endedAt = new Date();
    finishing.add(session.id);
    forgetSession(session);
    await store.closeAllMemberIntervals({ sessionId: session.id, at: endedAt });
    const ended = await store.endSession(session.id, endedAt);
    if (!ended) return null;

    await restoreRoom(channel, ended);
    if (ended.nudgeMessageId) {
        const general = await client.channels.fetch(GYM_CLASS_GENERAL_CHANNEL_ID).catch(() => null);
        await general?.messages?.delete(ended.nudgeMessageId).catch(() => {});
    }

    // A session that never saw an activity produced no measurements, so there is
    // nothing worth a row; the room is still handed back above.
    if (!ended.activityStartedAt) {
        logger.info(`[Host Session] Session ${ended.id} ended before an activity started; nothing logged.`);
        return ended;
    }

    const summary = await publishSession(ended);
    logger.info(`[Host Session] Session ${ended.id} ended: ${summary.uniqueJoiners} unique joiner(s), avg ${summary.avgMinutes} min.`);
    return ended;
};

// Entry point for the confirm button. The room is renamed and opened up straight
// away so the host can launch the activity; tracking waits for that activity.
const startSession = async ({ channel, hostMember }) => {
    const originalName = channel.name;
    const session = await store.createSession({
        guildId: channel.guild.id,
        channelId: channel.id,
        hostId: hostMember.id,
        hostName: hostMember.displayName,
        originalName,
    });
    if (!session) return null;

    indexSession(session);
    try {
        await openRoomForActivities(channel, hostMember.id);
        await channel.setName(eventChannelName(hostMember.displayName));
    } catch (error) {
        // The room is handed back before the row is closed: a failure to end the
        // session must not leave a renamed, activity-enabled room behind.
        logger.error(`[Host Session] Failed to open room for session ${session.id}; rolling back.`, error);
        forgetSession(session);
        await restoreRoom(channel, session);
        await store.endSession(session.id);
        throw error;
    }
    logger.info(`[Host Session] Session ${session.id} opened by ${hostMember.displayName} in ${channel.id}.`);
    await tryGoLiveFromPresence(channel.client, session, hostMember.presence);
    return session;
};

// presenceUpdate only fires on a change, so a host who already had a game open
// when they ran the command would never produce one. Every path that starts or
// resumes a session checks the presence it can already see.
const tryGoLiveFromPresence = async (client, session, presence) => {
    const activity = presence?.activities?.find(isTrackedActivity);
    if (!activity) return false;
    await goLive(client, session, activity.name);
    return true;
};

const onPresenceUpdate = async (_oldPresence, newPresence, client) => {
    const session = pendingByHost.get(newPresence?.userId);
    if (!session) return;
    await tryGoLiveFromPresence(client, session, newPresence);
};

const onVoiceStateUpdate = async (oldState, newState, client) => {
    if (oldState.channelId === newState.channelId) return;
    const member = newState.member || oldState.member;
    if (member?.user?.bot) return;

    const left = oldState.channelId ? sessionsByChannel.get(oldState.channelId) : null;
    if (left) {
        if (member.id === left.hostId) {
            await finishSession(client, left, { channel: oldState.channel });
        } else if (left.activityStartedAt) {
            await store.closeMemberInterval({ sessionId: left.id, userId: member.id });
        }
    }

    const joined = newState.channelId ? sessionsByChannel.get(newState.channelId) : null;
    if (joined?.activityStartedAt && member.id !== joined.hostId) {
        await store.openMemberInterval({ sessionId: joined.id, userId: member.id });
        await store.recordPeakConcurrent(joined.id, countParticipants(newState.channel, joined.hostId));
    }
};

// Restart recovery. A session whose host is still in the room keeps running with
// its members re-credited from now; anything else is closed out so the sheet still
// gets a row and the room stops advertising an event nobody is running.
// Retries rows the Sheets API refused earlier, so an outage or a permissions gap
// costs a delay rather than the session data.
const retryUnwrittenSessions = async () => {
    const pending = await store.listUnwrittenSessions();
    if (pending.length === 0) return;
    logger.info(`[Host Session] Retrying ${pending.length} session row(s) that never reached the sheet.`);
    for (const session of pending) {
        await publishSession(session).catch((error) => {
            logger.error(`[Host Session] Retry failed for session ${session.id}:`, error);
        });
    }
};

const resumeSessions = async (client) => {
    await retryUnwrittenSessions().catch((error) => {
        logger.error('[Host Session] Failed to retry unwritten sessions:', error);
    });
    const sessions = await store.listActiveSessions();
    for (const session of sessions) {
        try {
            const channel = await client.channels.fetch(session.channelId).catch(() => null);
            const hostPresent = Boolean(channel?.members?.has(session.hostId));
            if (!hostPresent) {
                await finishSession(client, session, { channel });
                continue;
            }

            indexSession(session);
            if (session.activityStartedAt) {
                // Voice membership survives a bot restart, so anyone still in the
                // room keeps their original joined_at and loses no time. Only the
                // people who left unobserved are closed out, and their overcount is
                // bounded by how long the bot was down.
                const present = channel.members.filter((member) => !member.user.bot);
                await store.closeMemberIntervalsExcept({
                    sessionId: session.id,
                    presentUserIds: present.map((member) => member.id),
                });
                // Idempotent: it keeps an existing joined_at untouched and only
                // counts a join for someone who arrived during the downtime.
                for (const member of present.values()) {
                    await store.openMemberInterval({ sessionId: session.id, userId: member.id });
                }
                startNudgeLoop(client, session);
            } else {
                // The activity may have started while the bot was down.
                await tryGoLiveFromPresence(client, session, channel.members.get(session.hostId)?.presence);
            }
            logger.info(`[Host Session] Resumed session ${session.id} in channel ${session.channelId}.`);
        } catch (error) {
            logger.error(`[Host Session] Failed to resume session ${session.id}:`, error);
        }
    }
};

module.exports = {
    startSession,
    finishSession,
    resumeSessions,
    getSessionByChannel,
    onPresenceUpdate,
    onVoiceStateUpdate,
    isTrackedActivity,
};
