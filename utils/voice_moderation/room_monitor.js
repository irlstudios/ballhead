'use strict';

// Per-room transcription cycle for public rooms. Every cycle drains each
// speaker's speech since the last cycle, sends it to the PC whisper server,
// scans the text, and alerts on tier 1 hits. Registry of active monitors
// follows the capture.js module-Map precedent.

const { OpusEncoder } = require('@discordjs/opus');
const { AttachmentBuilder, ContainerBuilder, MessageFlags } = require('discord.js');
const logger = require('../logger');
const { buildTextBlock } = require('../ui');
const { drainUserChunks } = require('./chunker');
const { transcribeWav } = require('./whisper_client');
const { scanTranscript } = require('./keyword_scan');
const { getCaptureState } = require('./capture');
const { clipFromCapture } = require('./clipper');
const { insertIncident } = require('./incidents');
const {
    MODERATOR_ROLES, VOICE_EVIDENCE_CHANNEL_ID, VOICE_CHUNK_CYCLE_SECONDS,
    VOICE_CLIP_DEFAULT_SECONDS,
} = require('../../config/constants');

// channelId -> { timer, lastCycleEndMs, hostId }
const monitors = new Map();

const activeMonitorCount = () => monitors.size;

const runCycle = async ({ store, decodeForUser, sinceMs, nowMs, transcribe, scan, onFlag }) => {
    const chunks = drainUserChunks({ store, decodeForUser, sinceMs, nowMs });
    let attempted = 0; let failed = 0; let flags = 0;
    for (const [userId, wav] of chunks) {
        attempted += 1;
        const result = await transcribe(wav);
        if (!result.ok) {
            failed += 1;
            logger.warn(`[Voice Mod] Chunk transcription failed for ${userId}: ${result.reason}`);
            continue;
        }
        if (process.env.VOICE_DEBUG_TRANSCRIPTS === '1') {
            logger.info(`[Voice Mod] Transcript ${userId}: "${result.text}"`);
        }
        if (!result.text) continue;
        const matches = scan(result.text);
        if (matches.tier2.length > 0) {
            logger.info(`[Voice Mod] Tier2 watch words from ${userId}: ${matches.tier2.join(', ')}`);
        }
        if (matches.tier1.length > 0) {
            flags += 1;
            await onFlag({ userId, matches: matches.tier1, text: result.text });
        }
    }
    return { attempted, failed, flags };
};

const postFlagAlert = async ({ client, channelId, hostId, userId, matches, text }) => {
    try {
        const clip = clipFromCapture({ channelId, durationSeconds: VOICE_CLIP_DEFAULT_SECONDS });
        const evidenceChannel = await client.channels.fetch(VOICE_EVIDENCE_CHANNEL_ID);
        const container = new ContainerBuilder().setAccentColor(0xEF4444);
        const block = buildTextBlock({
            title: 'Voice Flag',
            subtitle: 'Public Room Auto Alert',
            lines: [
                `Room: <#${channelId}> (host <@${hostId}>)`,
                `Speaker: <@${userId}>`,
                `Matched: ${matches.join(', ')}`,
                `Transcript: ${text.slice(0, 500)}`,
            ],
        });
        if (block) container.addTextDisplayComponents(block);
        const files = clip
            ? [new AttachmentBuilder(clip.wav, { name: `flag-${channelId}-${Date.now()}.wav` })]
            : [];
        const message = await evidenceChannel.send({
            content: `<@&${MODERATOR_ROLES[0]}>`,
            flags: MessageFlags.IsComponentsV2,
            components: [container],
            files,
            allowedMentions: { roles: [MODERATOR_ROLES[0]] },
        });
        await insertIncident({
            sessionId: null,
            channelId,
            clippedBy: 'auto-flag',
            note: `tier1: ${matches.join(', ')}`,
            windowStart: new Date(clip ? clip.windowStartMs : Date.now()),
            windowEnd: new Date(clip ? clip.windowEndMs : Date.now()),
            participantIds: clip ? clip.participantIds : [userId],
            evidenceMessageUrl: message.url,
        });
    } catch (error) {
        logger.error(`[Voice Mod] Flag alert failed for ${channelId}:`, error);
    }
};

const startRoomMonitor = ({ client, channelId, hostId, onCycleOutcome }) => {
    if (monitors.has(channelId)) return;
    const monitor = { timer: null, lastCycleEndMs: Date.now(), hostId };
    monitors.set(channelId, monitor);
    monitor.timer = setInterval(async () => {
        const state = getCaptureState(channelId);
        if (!state) {
            stopRoomMonitor(channelId);
            return;
        }
        const nowMs = Date.now();
        const sinceMs = monitor.lastCycleEndMs;
        monitor.lastCycleEndMs = nowMs;
        try {
            const outcome = await runCycle({
                store: state.store,
                decodeForUser: () => {
                    const decoder = new OpusEncoder(48000, 2);
                    return (packet) => {
                        try {
                            return decoder.decode(packet);
                        } catch {
                            return null;
                        }
                    };
                },
                sinceMs, nowMs,
                transcribe: transcribeWav,
                scan: scanTranscript,
                onFlag: (flag) => postFlagAlert({ client, channelId, hostId, ...flag }),
            });
            if (outcome.attempted > 0) {
                logger.info(`[Voice Mod] Cycle for ${channelId}: ${outcome.attempted} chunk(s), ${outcome.failed} failed, ${outcome.flags} flag(s).`);
                onCycleOutcome(outcome.failed < outcome.attempted);
            }
        } catch (error) {
            logger.error(`[Voice Mod] Cycle failed for ${channelId}:`, error);
            onCycleOutcome(false);
        }
    }, VOICE_CHUNK_CYCLE_SECONDS * 1000);
    if (typeof monitor.timer.unref === 'function') monitor.timer.unref();
    logger.info(`[Voice Mod] Room monitor started for ${channelId}.`);
};

const stopRoomMonitor = (channelId) => {
    const monitor = monitors.get(channelId);
    if (!monitor) return;
    monitors.delete(channelId);
    clearInterval(monitor.timer);
    logger.info(`[Voice Mod] Room monitor stopped for ${channelId}.`);
};

module.exports = { runCycle, startRoomMonitor, stopRoomMonitor, activeMonitorCount, postFlagAlert };
