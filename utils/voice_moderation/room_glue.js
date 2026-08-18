'use strict';

// Where the public room gate meets the room lifecycle. Rooms are public by
// default; this module decides whether a new room may stay public, whether
// an unlock is allowed, and starts or stops capture plus monitoring.

const logger = require('../logger');
const capture = require('./capture');
const { canGoPublic } = require('./public_gate');
const { startRoomMonitor, stopRoomMonitor } = require('./room_monitor');

let healthCheck = () => false;

const initRoomModeration = ({ isHealthy }) => { healthCheck = isHealthy; };

const monitoringMode = () => {
    const mode = process.env.VOICE_ROOM_MONITORING || 'off';
    return ['off', 'shadow', 'on'].includes(mode) ? mode : 'off';
};

const roomNotice = {
    subtitle: 'Public Room',
    lines: [
        'This public room is monitored. Audio is buffered and transcribed for moderation while the room is open.',
        'Transcripts are scanned and discarded; audio is stored only if an incident is flagged.',
    ],
};

const beginRoomCapture = async ({ channel, hostId, client, onCycleOutcome }) => {
    await capture.joinSession({
        channel,
        session: { id: `room:${channel.id}`, hostId },
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
    if (mode !== 'on') return { ok: true, reason: null };
    if (capture.getCaptureState(channel.id)) return { ok: true, reason: null };
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

module.exports = { initRoomModeration, monitoringMode, gateNewRoom, gateUnlock, onRoomGone };
