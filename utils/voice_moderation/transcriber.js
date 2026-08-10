'use strict';

// Mod-triggered live transcription. One Deepgram streaming connection per
// speaker gives true attribution with no diarization guesswork; the capture
// tap hands this module decoded mono PCM only while monitoring is on, so
// transcription cost accrues only then. Lines land in a thread on the
// evidence channel in batches.
//
// Written against @deepgram/sdk v5: DeepgramClient, listen.v1.connect,
// sendMedia/sendKeepAlive/sendCloseStream, 'message' events of type Results.

const { DeepgramClient } = require('@deepgram/sdk');
const { setTimeout: sleep } = require('node:timers/promises');
const logger = require('../logger');
const { setTap, clearTap, getCaptureState } = require('./capture');
const {
    VOICE_EVIDENCE_CHANNEL_ID, VOICE_MONITOR_MAX_SPEAKERS, VOICE_TRANSCRIPT_FLUSH_SECONDS,
} = require('../../config/constants');

// channelId -> { thread, speakers: Map<userId, { live, keepAlive, name }>,
//                pending: [], flushTimer, guild }
const monitors = new Map();

const batchTranscriptLines = (lines, maxLen = 1900) => {
    const rendered = lines.map(({ name, text }) => {
        const line = `**${name}:** ${text}`;
        return line.length > maxLen ? line.slice(0, maxLen) : line;
    });
    const batches = [];
    let current = '';
    for (const line of rendered) {
        if (current && current.length + 1 + line.length > maxLen) {
            batches.push(current);
            current = line;
        } else {
            current = current ? `${current}\n${line}` : line;
        }
    }
    if (current) batches.push(current);
    return batches;
};

const isMonitoring = (channelId) => monitors.has(channelId);

const postBatches = async (monitor, lines) => {
    for (const content of batchTranscriptLines(lines)) {
        await monitor.thread.send({ content, allowedMentions: { parse: [] } }).catch((error) => {
            logger.error('[Voice Mod] Transcript post failed:', error);
        });
    }
};

const flush = async (channelId) => {
    const monitor = monitors.get(channelId);
    if (!monitor || monitor.pending.length === 0) return;
    await postBatches(monitor, monitor.pending.splice(0, monitor.pending.length));
};

const speakerName = async (monitor, userId) => {
    const member = await monitor.guild.members.fetch(userId).catch(() => null);
    return member?.displayName || `user ${userId}`;
};

// The caller has already reserved the speaker entry (with any backlogged
// audio); this fills in the live connection and drains the backlog. If the
// monitor was torn down while the socket was opening, the connection is
// closed immediately instead of leaking past stopMonitoring.
const openSpeaker = async (monitor, channelId, userId, speaker) => {
    try {
        speaker.name = await speakerName(monitor, userId);
        const client = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });
        const live = await client.listen.v1.connect({
            model: 'nova-3', encoding: 'linear16', sample_rate: 48000, channels: 1,
            smart_format: true, interim_results: false,
        });
        live.on('message', (data) => {
            if (data?.type !== 'Results') return;
            const text = data.channel?.alternatives?.[0]?.transcript;
            if (text) monitor.pending.push({ name: speaker.name, text });
        });
        live.on('error', (error) => {
            logger.error(`[Voice Mod] Deepgram error for ${userId} in ${channelId}:`, error);
        });
        live.on('close', () => {
            clearInterval(speaker.keepAlive);
            // Dropping the entry lets the next packet from this speaker reopen
            // a fresh connection while monitoring is still on: reconnect by rebirth.
            const current = monitors.get(channelId);
            if (current === monitor) monitor.speakers.delete(userId);
        });
        live.connect();
        await live.waitForOpen();
        if (monitors.get(channelId) !== monitor) {
            live.close();
            return;
        }
        speaker.keepAlive = setInterval(() => {
            try {
                live.sendKeepAlive({ type: 'KeepAlive' });
            } catch {
                // Connection is closing; the close handler cleans up.
            }
        }, 8000);
        if (typeof speaker.keepAlive.unref === 'function') speaker.keepAlive.unref();
        for (const pcm of speaker.backlog.splice(0, speaker.backlog.length)) {
            live.sendMedia(pcm);
        }
        speaker.live = live;
    } catch (error) {
        monitor.speakers.delete(userId);
        throw error;
    }
};

// ~10s of 48kHz mono at 20ms frames; bounds memory if a socket never opens.
const SPEAKER_BACKLOG_MAX = 500;

const startMonitoring = async ({ client, channelId, startedById }) => {
    if (!process.env.DEEPGRAM_API_KEY) return { ok: false, reason: 'unconfigured' };
    if (monitors.has(channelId)) return { ok: false, reason: 'already-monitoring' };
    const state = getCaptureState(channelId);
    if (!state) return { ok: false, reason: 'no-session' };

    const evidenceChannel = await client.channels.fetch(VOICE_EVIDENCE_CHANNEL_ID);
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const thread = await evidenceChannel.threads.create({
        name: `transcript session ${state.session.id} ${stamp}`,
        autoArchiveDuration: 1440,
    });
    await thread.send({
        content: `Live transcript of <#${channelId}> started by <@${startedById}>.`,
        allowedMentions: { parse: [] },
    });

    const monitor = {
        thread, speakers: new Map(), pending: [], flushTimer: null, guild: evidenceChannel.guild,
    };
    monitors.set(channelId, monitor);
    monitor.flushTimer = setInterval(() => { void flush(channelId); }, VOICE_TRANSCRIPT_FLUSH_SECONDS * 1000);
    if (typeof monitor.flushTimer.unref === 'function') monitor.flushTimer.unref();

    const tapInstalled = setTap(channelId, (userId, monoPcm) => {
        const speaker = monitor.speakers.get(userId);
        if (speaker?.live) {
            try {
                speaker.live.sendMedia(monoPcm);
            } catch {
                // Connection is closing; rebirth on the next packet handles it.
            }
        } else if (speaker) {
            // Socket still opening: keep the audio so the first words survive.
            if (speaker.backlog.length < SPEAKER_BACKLOG_MAX) speaker.backlog.push(monoPcm);
        } else if (monitor.speakers.size < VOICE_MONITOR_MAX_SPEAKERS) {
            // Reserve synchronously, first packet included, so a burst cannot
            // open duplicate connections and the opening words are not lost.
            const reserved = { live: null, keepAlive: null, name: null, backlog: [monoPcm] };
            monitor.speakers.set(userId, reserved);
            void openSpeaker(monitor, channelId, userId, reserved).catch((error) => {
                logger.error(`[Voice Mod] Could not open transcription for ${userId}:`, error);
            });
        }
    });
    if (!tapInstalled) {
        // The session closed while the thread was being created.
        monitors.delete(channelId);
        clearInterval(monitor.flushTimer);
        await thread.send({ content: 'Session ended before monitoring could start.', allowedMentions: { parse: [] } }).catch(() => {});
        return { ok: false, reason: 'no-session' };
    }
    logger.info(`[Voice Mod] Monitoring started for channel ${channelId} by ${startedById}.`);
    return { ok: true, threadUrl: thread.url };
};

const stopMonitoring = async (channelId) => {
    const monitor = monitors.get(channelId);
    if (!monitor) return;
    monitors.delete(channelId);
    clearTap(channelId);
    clearInterval(monitor.flushTimer);
    // CloseStream first, then a short grace so Deepgram can return the final
    // Results for audio it is still holding; only then drop the sockets.
    // Entries whose socket is still opening (live null) are handled by
    // openSpeaker's registry check, which closes them on arrival.
    const open = [...monitor.speakers.values()].filter((speaker) => speaker.live);
    for (const speaker of open) {
        clearInterval(speaker.keepAlive);
        try {
            speaker.live.sendCloseStream({ type: 'CloseStream' });
        } catch {
            // Already closed.
        }
    }
    if (open.length > 0) await sleep(1500);
    for (const speaker of open) {
        try {
            speaker.live.close();
        } catch {
            // Already closed.
        }
    }
    monitor.speakers.clear();
    // flush() reads the registry, which no longer holds this entry: drain inline.
    await postBatches(monitor, monitor.pending.splice(0, monitor.pending.length));
    await monitor.thread.send({ content: 'Monitoring stopped.', allowedMentions: { parse: [] } }).catch(() => {});
    logger.info(`[Voice Mod] Monitoring stopped for channel ${channelId}.`);
};

// One-shot transcription of a finished clip WAV for the evidence post.
// Returns null when unconfigured or on failure: the clip must post either way.
const transcribeClip = async (wavBuffer) => {
    if (!process.env.DEEPGRAM_API_KEY) return null;
    try {
        const client = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });
        const result = await client.listen.v1.media.transcribeFile(wavBuffer, {
            model: 'nova-3', smart_format: true,
        });
        const transcript = result.results?.channels?.[0]?.alternatives?.[0]?.transcript;
        return transcript ? transcript.trim() : null;
    } catch (error) {
        logger.error('[Voice Mod] Clip transcription failed:', error);
        return null;
    }
};

module.exports = { batchTranscriptLines, isMonitoring, startMonitoring, stopMonitoring, transcribeClip };
