'use strict';

// Where the public room gate meets the room lifecycle. Rooms are public by
// default; this module decides whether a new room may stay public, whether
// an unlock is allowed, and starts or stops capture plus monitoring.

const { PermissionFlagsBits } = require('discord.js');
const { setTimeout: sleep } = require('node:timers/promises');
const logger = require('../logger');
const { pool } = require('../../db');
const capture = require('./capture');
const { canGoPublic } = require('./public_gate');
const { startRoomMonitor, stopRoomMonitor } = require('./room_monitor');

let healthCheck = () => false;
let clientRef = null;
let cycleOutcomeRef = () => {};

const initRoomModeration = ({ isHealthy, client, onCycleOutcome }) => {
    healthCheck = isHealthy;
    clientRef = client;
    if (onCycleOutcome) cycleOutcomeRef = onCycleOutcome;
    capture.setCaptureLostHandler((channelId) => { void handleCaptureLost(channelId); });
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
// that). Public room = monitored room, so it walks straight back in.
const handleCaptureLost = async (channelId) => {
    stopRoomMonitor(channelId);
    await sleep(3000);
    try {
        const rejoined = await makeRoomMonitored(channelId);
        if (rejoined) logger.info(`[Voice Mod] Rejoined ${channelId} after an unexpected disconnect.`);
    } catch (error) {
        logger.error(`[Voice Mod] Rejoin failed for ${channelId}: ${error?.message || error}`);
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
const resumeRoomCaptures = async () => {
    if (monitoringMode() === 'off') return;
    const { rows } = await pool.query('SELECT channel_id FROM vc_hosts');
    for (const row of rows) {
        try {
            const started = await makeRoomMonitored(row.channel_id);
            if (started) logger.info(`[Voice Mod] Resumed capture for room ${row.channel_id} after restart.`);
        } catch (error) {
            logger.error(`[Voice Mod] Could not resume capture for ${row.channel_id}:`, error);
        }
    }
};

module.exports = {
    initRoomModeration, monitoringMode, gateNewRoom, gateUnlock, onRoomGone,
    onRoomLocked, makeRoomMonitored, resumeRoomCaptures,
};
