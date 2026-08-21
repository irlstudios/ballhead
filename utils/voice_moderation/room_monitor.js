'use strict';

// Per-room transcription for public rooms, utterance-driven for speed: the
// capture layer signals when a speaker goes silent and that speaker's audio
// since their last drain is transcribed and scanned immediately, so a tier 1
// alert lands seconds after the sentence ends. A slow periodic sweep catches
// anything the utterance path missed (very long continuous talkers, missed
// end events) and keeps health facts flowing. Registry of active monitors
// follows the capture.js module-Map precedent.

const { OpusEncoder } = require('@discordjs/opus');
const logger = require('../logger');
const { drainUserChunks } = require('./chunker');
const { transcribeWav } = require('./whisper_client');
const { scanTranscript } = require('./keyword_scan');
const { getCaptureState, setUtteranceHook, clearUtteranceHook } = require('./capture');
const { clipFromCapture } = require('./clipper');
const { insertIncident } = require('./incidents');
const { applyEnforcement, sendEnforcementNotice } = require('./enforcement');
const { buildEvidenceMessage } = require('./evidence_post');
const { transcribeClipSpeakers, formatClipTranscript } = require('./transcriber');
const {
    VOICE_ALERT_DM_USER_ID, VOICE_CHUNK_CYCLE_SECONDS, VOICE_CLIP_DEFAULT_SECONDS,
} = require('../../config/constants');

// channelId -> { timer, hostId, startedMs, lastDrain: Map<userId, ms>,
//                inFlight: Set<userId>, client, onCycleOutcome }
const monitors = new Map();

const activeMonitorCount = () => monitors.size;

const freshDecoderFor = () => {
    const decoder = new OpusEncoder(48000, 2);
    return (packet) => {
        try {
            return decoder.decode(packet);
        } catch {
            return null;
        }
    };
};

// Core per-speaker drain: pull this user's speech in [sinceMs, nowMs],
// transcribe, scan, and flag. Fully injected for tests.
const drainUser = async ({ store, decodeForUser, userId, sinceMs, nowMs, transcribe, scan, onFlag }) => {
    const chunks = drainUserChunks({ store, decodeForUser, sinceMs, nowMs, users: [userId] });
    const wav = chunks.get(userId);
    if (!wav) return { drained: false, ok: true, flagged: false };
    const result = await transcribe(wav);
    if (!result.ok) {
        logger.warn(`[Voice Mod] Chunk transcription failed for ${userId}: ${result.reason}`);
        return { drained: true, ok: false, flagged: false };
    }
    if (process.env.VOICE_DEBUG_TRANSCRIPTS === '1') {
        logger.info(`[Voice Mod] Transcript ${userId}: "${result.text}"`);
    }
    if (!result.text) return { drained: true, ok: true, flagged: false };
    const matches = scan(result.text);
    if (matches.tier2.length > 0) {
        logger.info(`[Voice Mod] Tier2 watch words from ${userId}: ${matches.tier2.join(', ')}`);
    }
    if (matches.tier1.length > 0) {
        await onFlag({ userId, matches: matches.tier1, text: result.text });
        return { drained: true, ok: true, flagged: true };
    }
    return { drained: true, ok: true, flagged: false };
};

const timestampField = (nowMs) => `<t:${Math.floor(nowMs / 1000)}:f> (<t:${Math.floor(nowMs / 1000)}:R>)`;

const postFlagAlert = async ({ client, channelId, hostId, userId, matches, text }) => {
    try {
        const clip = clipFromCapture({ channelId, durationSeconds: VOICE_CLIP_DEFAULT_SECONDS });
        const roomChannel = client.channels.cache.get(channelId);
        const alertUser = await client.users.fetch(VOICE_ALERT_DM_USER_ID);

        const enforcement = roomChannel
            ? await applyEnforcement({
                guild: roomChannel.guild,
                userId,
                reason: `Voice moderation tier1: ${matches.join(', ')}`,
            })
            : { actions: [], failures: ['room channel not found, no action taken'] };

        const notice = await sendEnforcementNotice({
            client, userId,
            actions: enforcement.actions,
            transcript: text.slice(0, 900),
            clipWav: clip?.userWavs?.get(userId),
        });
        const actionsTaken = notice.sent
            ? [...enforcement.actions, 'user notified by DM']
            : enforcement.actions;
        const actionFailures = notice.sent
            ? enforcement.failures
            : [...enforcement.failures, `user DM not sent: ${notice.reason}`];

        const fileName = `flag-${channelId}-${Date.now()}.wav`;
        const message = await alertUser.send(buildEvidenceMessage({
            accentColor: 0xE53E3E,
            title: 'Voice Flag',
            kicker: 'Automatic detection in a public room',
            fields: [
                ['Speaker', `<@${userId}>`],
                ['Room', `<#${channelId}> (host <@${hostId}>)`],
                ['Matched terms', matches.map((match) => `\`${match}\``).join('  ')],
                ['When', timestampField(Date.now())],
            ],
            transcript: text.slice(0, 900),
            actionsTaken,
            actionFailures,
            clipWav: clip?.wav,
            fileName,
            allowedMentions: { parse: [] },
        }));

        await insertIncident({
            sessionId: null,
            channelId,
            clippedBy: 'auto-flag',
            note: `tier1: ${matches.join(', ')} | actions: ${enforcement.actions.join(', ') || 'none'}`,
            windowStart: new Date(clip ? clip.windowStartMs : Date.now()),
            windowEnd: new Date(clip ? clip.windowEndMs : Date.now()),
            participantIds: clip ? clip.participantIds : [userId],
            evidenceMessageUrl: message.url,
        });
    } catch (error) {
        // String-only log: winston's meta stringify can choke on Discord
        // error objects and silently drop the line.
        logger.error(`[Voice Mod] Flag alert failed for ${channelId}: ${error?.message || error}`);
    }
};

// User-triggered report: clip the recent window, transcribe it for context,
// and post it for review. No automatic punishment on reports; mods decide.
const postRoomReport = async ({ client, channelId, reporterId }) => {
    const state = getCaptureState(channelId);
    if (!state) return { ok: false, reason: 'not-monitored' };
    const clip = clipFromCapture({ channelId, durationSeconds: VOICE_CLIP_DEFAULT_SECONDS });
    if (!clip) return { ok: false, reason: 'no-audio' };
    try {
        const roomChannel = client.channels.cache.get(channelId);
        const alertUser = await client.users.fetch(VOICE_ALERT_DM_USER_ID);
        const namesByUserId = new Map();
        for (const participantId of clip.participantIds) {
            const member = roomChannel
                ? await roomChannel.guild.members.fetch(participantId).catch(() => null)
                : null;
            namesByUserId.set(participantId, member?.displayName || `user ${participantId}`);
        }
        const transcript = formatClipTranscript(
            await transcribeClipSpeakers(clip.userWavs, namesByUserId), 900
        );
        const fileName = `report-${channelId}-${Date.now()}.wav`;
        const message = await alertUser.send(buildEvidenceMessage({
            accentColor: 0xF59E0B,
            title: 'Room Report',
            kicker: 'A member asked for review',
            fields: [
                ['Reported by', `<@${reporterId}>`],
                ['Room', `<#${channelId}> (host <@${state.session.hostId || 'unknown'}>)`],
                ['In the clip', clip.participantIds.map((id) => `<@${id}>`).join(' ')],
                ['When', timestampField(Date.now())],
            ],
            transcript: transcript || null,
            actionsTaken: [],
            actionFailures: [],
            clipWav: clip.wav,
            fileName,
            allowedMentions: { parse: [] },
        }));
        await insertIncident({
            sessionId: null,
            channelId,
            clippedBy: reporterId,
            note: 'user report',
            windowStart: new Date(clip.windowStartMs),
            windowEnd: new Date(clip.windowEndMs),
            participantIds: clip.participantIds,
            evidenceMessageUrl: message.url,
        });
        return { ok: true };
    } catch (error) {
        logger.error(`[Voice Mod] Room report failed for ${channelId}: ${error?.message || error}`);
        return { ok: false, reason: 'post-failed' };
    }
};

// Drain one speaker now, with per-user window bookkeeping and an in-flight
// guard so an utterance drain and the sweep never scan the same audio twice.
// The window only advances when audio was actually drained; sub-threshold
// fragments wait for the next utterance or sweep.
const drainSpeakerNow = async (channelId, userId) => {
    const monitor = monitors.get(channelId);
    if (!monitor) return;
    const state = getCaptureState(channelId);
    if (!state) {
        stopRoomMonitor(channelId);
        return;
    }
    if (monitor.inFlight.has(userId)) return;
    monitor.inFlight.add(userId);
    try {
        const nowMs = Date.now();
        const sinceMs = monitor.lastDrain.get(userId) || monitor.startedMs;
        const outcome = await drainUser({
            store: state.store,
            decodeForUser: freshDecoderFor,
            userId, sinceMs, nowMs,
            transcribe: transcribeWav,
            scan: scanTranscript,
            onFlag: (flag) => postFlagAlert({
                client: monitor.client, channelId, hostId: monitor.hostId, ...flag,
            }),
        });
        if (outcome.drained) {
            monitor.lastDrain.set(userId, nowMs);
            monitor.onCycleOutcome(outcome.ok);
            if (outcome.flagged) {
                logger.info(`[Voice Mod] Tier1 flag for ${userId} in ${channelId}.`);
            }
        }
    } catch (error) {
        logger.error(`[Voice Mod] Drain failed for ${userId} in ${channelId}:`, error);
        monitor.onCycleOutcome(false);
    } finally {
        monitor.inFlight.delete(userId);
    }
};

const startRoomMonitor = ({ client, channelId, hostId, onCycleOutcome }) => {
    if (monitors.has(channelId)) return;
    const monitor = {
        timer: null, hostId, startedMs: Date.now(), lastDrain: new Map(),
        inFlight: new Set(), client, onCycleOutcome,
    };
    monitors.set(channelId, monitor);

    // Fast path: the capture layer fires this the second a speaker goes
    // quiet, so the alert lands while the conversation is still happening.
    setUtteranceHook(channelId, (userId) => { void drainSpeakerNow(channelId, userId); });

    // Slow sweep: long continuous talkers and missed end events.
    monitor.timer = setInterval(() => {
        const state = getCaptureState(channelId);
        if (!state) {
            stopRoomMonitor(channelId);
            return;
        }
        for (const userId of state.store.users.keys()) {
            void drainSpeakerNow(channelId, userId);
        }
    }, VOICE_CHUNK_CYCLE_SECONDS * 1000);
    if (typeof monitor.timer.unref === 'function') monitor.timer.unref();
    logger.info(`[Voice Mod] Room monitor started for ${channelId}.`);
};

const stopRoomMonitor = (channelId) => {
    const monitor = monitors.get(channelId);
    if (!monitor) return;
    monitors.delete(channelId);
    clearUtteranceHook(channelId);
    clearInterval(monitor.timer);
    logger.info(`[Voice Mod] Room monitor stopped for ${channelId}.`);
};

module.exports = {
    drainUser, startRoomMonitor, stopRoomMonitor, activeMonitorCount,
    postFlagAlert, postRoomReport,
};
