'use strict';

// Where the public room gate meets the room lifecycle. Rooms are public by
// default; this module decides whether a new room may stay public, whether
// an unlock is allowed, and starts or stops capture plus monitoring.

const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { setTimeout: sleep } = require('node:timers/promises');
const logger = require('../logger');
const { pool } = require('../../db');
const capture = require('./capture');
const { canGoPublic } = require('./public_gate');
const { startRoomMonitor, stopRoomMonitor } = require('./room_monitor');
const { VC_CREATE_CHANNEL_ID } = require('../../config/constants');

let healthCheck = () => false;
let clientRef = null;
let cycleOutcomeRef = () => {};

const SWEEP_INTERVAL_MS = 3 * 60 * 1000;
let sweepTimer = null;

const initRoomModeration = ({ isHealthy, client, onCycleOutcome }) => {
    healthCheck = isHealthy;
    clientRef = client;
    if (onCycleOutcome) cycleOutcomeRef = onCycleOutcome;
    capture.setCaptureLostHandler((channelId) => { void handleCaptureLost(channelId); });
    // Reconciler sweep: rooms can end up public and occupied without a
    // capture (empty at restart-resume then joined later, worker freed after
    // exhaustion). makeRoomMonitored is a quiet no-op for covered rooms.
    if (!sweepTimer) {
        sweepTimer = setInterval(() => { void resumeRoomCaptures(); }, SWEEP_INTERVAL_MS);
        if (typeof sweepTimer.unref === 'function') sweepTimer.unref();
    }
};

const isPublicRoom = (channel) => {
    const overwrite = channel.permissionOverwrites.cache.get(channel.guild.roles.everyone.id);
    return !overwrite || !overwrite.deny.has(PermissionFlagsBits.Connect);
};

const monitoringMode = () => {
    const mode = process.env.VOICE_ROOM_MONITORING || 'off';
    return ['off', 'shadow', 'on'].includes(mode) ? mode : 'off';
};

const roomNotice = {
    subtitle: 'Public Room',
    lines: [
        'This public room is monitored. Audio is buffered and transcribed for moderation while the room is public.',
        'Transcripts are scanned and discarded; audio is stored only if an incident is flagged. Locking the room ends monitoring.',
        'Something happening in here? Hit the button and a moderator gets the last minute of audio.',
    ],
    reportButton: true,
};

const beginRoomCapture = async ({ channel, hostId, client, onCycleOutcome }) => {
    await capture.joinSession({
        channel,
        session: { id: `room-${channel.id}`, hostId },
        workersOnly: true,
        notice: roomNotice,
    });
    if (!capture.getCaptureState(channel.id)) return false;
    startRoomMonitor({ client, channelId: channel.id, hostId, onCycleOutcome });
    return true;
};

// Decide a new room's fate. Returns { public: boolean, reason }.
const gateNewRoom = async ({ channel, hostId, client, onCycleOutcome }) => {
    const mode = monitoringMode();
    if (mode === 'off') return { public: true, reason: null };
    const decision = canGoPublic({
        healthy: healthCheck(),
        freeWorkers: capture.freeWorkerCountIn(channel.guild.id),
    });
    if (mode === 'shadow') {
        if (decision.ok) {
            await beginRoomCapture({ channel, hostId, client, onCycleOutcome }).catch((error) => {
                logger.error(`[Voice Mod] Shadow capture failed for ${channel.id}:`, error);
            });
        }
        return { public: true, reason: null };
    }
    if (!decision.ok) return { public: false, reason: decision.reason };
    const captured = await beginRoomCapture({ channel, hostId, client, onCycleOutcome })
        .catch((error) => {
            logger.error(`[Voice Mod] Capture failed for ${channel.id}:`, error);
            return false;
        });
    return captured ? { public: true, reason: null } : { public: false, reason: 'capture-failed' };
};

const gateUnlock = async ({ channel, hostId, client, onCycleOutcome }) => {
    const mode = monitoringMode();
    if (mode === 'off') return { ok: true, reason: null };
    if (capture.getCaptureState(channel.id)) return { ok: true, reason: null };
    if (mode === 'shadow') {
        await beginRoomCapture({ channel, hostId, client, onCycleOutcome }).catch((error) => {
            logger.error(`[Voice Mod] Shadow capture on unlock failed for ${channel.id}:`, error);
        });
        return { ok: true, reason: null };
    }
    const decision = canGoPublic({
        healthy: healthCheck(),
        freeWorkers: capture.freeWorkerCountIn(channel.guild.id),
    });
    if (!decision.ok) return { ok: false, reason: decision.reason };
    const captured = await beginRoomCapture({ channel, hostId, client, onCycleOutcome })
        .catch(() => false);
    return captured ? { ok: true, reason: null } : { ok: false, reason: 'capture-failed' };
};

const onRoomGone = (channelId) => {
    stopRoomMonitor(channelId);
    capture.leaveSession(channelId);
};

// Re-establish monitoring for a room that should have it: after an
// unexpected disconnect (bot kicked) or an outage recovery unlock. Looks up
// the host itself so callers only need the channel id.
const makeRoomMonitored = async (channelId) => {
    if (!clientRef || monitoringMode() === 'off') return false;
    const channel = clientRef.channels.cache.get(channelId);
    if (!channel || capture.getCaptureState(channelId)) return false;
    if (!isPublicRoom(channel)) return false;
    const humans = channel.members?.filter((member) => !member.user.bot).size || 0;
    if (humans === 0) return false;
    const { rows } = await pool.query('SELECT host_id FROM vc_hosts WHERE channel_id = $1', [channelId]);
    if (!rows[0]) return false;
    return beginRoomCapture({
        channel, hostId: rows[0].host_id, client: clientRef, onCycleOutcome: cycleOutcomeRef,
    });
};

// The bot was thrown out of a room it should be monitoring (a host with
// MoveMembers can always disconnect it; Discord offers no way to prevent
// that). Public room = monitored room, so it walks straight back in, with
// retries because a kick can land mid-handshake. Someone who keeps kicking
// the bot loses the public room: repeated disconnects lock it.
const REJOIN_WINDOW_MS = 10 * 60 * 1000;
const REJOIN_LIMIT = 3;
const rejoinTracker = new Map();

const lockRoomForSabotage = async (channelId) => {
    const channel = clientRef?.channels.cache.get(channelId);
    if (!channel) return;
    try {
        await channel.permissionOverwrites.edit(channel.guild.roles.everyone, { Connect: false });
        await channel.send({
            content: 'The moderation bot was repeatedly disconnected from this room, so it is now invite only. The host can use /room unlock to make it public again, which brings monitoring back.',
            allowedMentions: { parse: [] },
        }).catch(() => {});
        logger.warn(`[Voice Mod] Locked ${channelId}: capture bot repeatedly disconnected.`);
    } catch (error) {
        logger.error(`[Voice Mod] Sabotage lock failed for ${channelId}: ${error?.message || error}`);
    }
};

const handleCaptureLost = async (channelId) => {
    stopRoomMonitor(channelId);
    const now = Date.now();
    const previous = rejoinTracker.get(channelId);
    const tracker = previous && now - previous.windowStart < REJOIN_WINDOW_MS
        ? previous
        : { count: 0, windowStart: now };
    tracker.count += 1;
    rejoinTracker.set(channelId, tracker);
    if (tracker.count > REJOIN_LIMIT) {
        rejoinTracker.delete(channelId);
        await lockRoomForSabotage(channelId);
        return;
    }
    for (const delayMs of [3000, 10000, 30000]) {
        await sleep(delayMs);
        try {
            if (await makeRoomMonitored(channelId)) {
                logger.info(`[Voice Mod] Rejoined ${channelId} after an unexpected disconnect.`);
                return;
            }
            const channel = clientRef?.channels.cache.get(channelId);
            if (!channel || !isPublicRoom(channel)) return;
        } catch (error) {
            logger.error(`[Voice Mod] Rejoin attempt failed for ${channelId}: ${error?.message || error}`);
        }
    }
};

// Host locked the room: locked rooms are private and unmonitored, so the
// bot leaves and the buffers are discarded.
const onRoomLocked = (channelId) => {
    onRoomGone(channelId);
};

// Restart recovery: captures live in memory, so a bot restart orphans every
// monitored room. Re-capture rooms that still exist, are public, and have
// humans in them; locked rooms are private and stay bot-free. Rooms the
// gate would now refuse are left alone rather than locked: they predate the
// restart and die on their own.
// A restart between channel creation and the vc_hosts insert leaves an
// orphan: a real room channel the system does not know about, which would
// otherwise never be monitored or auto-deleted. Adopt occupied orphans
// (host is the first human present) and delete empty ones.
const adoptOrphanRooms = async () => {
    if (!clientRef) return;
    const createChannel = clientRef.channels.cache.get(VC_CREATE_CHANNEL_ID);
    if (!createChannel?.guild) return;
    const { rows } = await pool.query('SELECT channel_id FROM vc_hosts');
    const managed = new Set(rows.map((row) => row.channel_id));
    // Personal rooms are identified by the name the create flow gives them,
    // not by category: permanent voice channels share categories with rooms.
    const orphans = createChannel.guild.channels.cache.filter((channel) =>
        channel.type === ChannelType.GuildVoice
        && channel.id !== VC_CREATE_CHANNEL_ID
        && !managed.has(channel.id)
        && /'s Room$/.test(channel.name));
    for (const [, channel] of orphans) {
        try {
            // NEVER delete anything here: an empty unmanaged channel might be
            // a permanent channel or a renamed room; deletion is not our call.
            // Occupied orphans get adopted; empty ones are left alone.
            const firstHuman = channel.members.find((member) => !member.user.bot);
            if (!firstHuman) continue;
            // host_id is UNIQUE; clear any stale row for this host first or
            // the adoption insert dies on the constraint.
            await pool.query(
                'DELETE FROM vc_hosts WHERE host_id = $2 AND channel_id <> $1',
                [channel.id, firstHuman.id]
            );
            await pool.query(
                `INSERT INTO vc_hosts(channel_id, host_id, created_at) VALUES($1, $2, now())
                 ON CONFLICT (channel_id) DO NOTHING`,
                [channel.id, firstHuman.id]
            );
            if (clientRef.vcHosts) clientRef.vcHosts.set(channel.id, firstHuman.id);
            logger.info(`[Voice Mod] Adopted orphan room ${channel.id} with host ${firstHuman.id}.`);
        } catch (error) {
            logger.error(`[Voice Mod] Orphan adoption failed for ${channel.id}: ${error?.message || error}`);
        }
    }
};

const resumeRoomCaptures = async () => {
    if (monitoringMode() === 'off') return;
    await adoptOrphanRooms().catch((error) => {
        logger.error(`[Voice Mod] Orphan sweep failed: ${error?.message || error}`);
    });
    const { rows } = await pool.query('SELECT channel_id FROM vc_hosts');
    for (const row of rows) {
        try {
            const started = await makeRoomMonitored(row.channel_id);
            if (started) logger.info(`[Voice Mod] Capture established for room ${row.channel_id}.`);
        } catch (error) {
            logger.error(`[Voice Mod] Could not resume capture for ${row.channel_id}:`, error);
        }
    }
};

module.exports = {
    initRoomModeration, monitoringMode, gateNewRoom, gateUnlock, onRoomGone,
    onRoomLocked, makeRoomMonitored, resumeRoomCaptures,
};
