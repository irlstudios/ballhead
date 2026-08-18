'use strict';

// Mod-triggered live transcription and clip transcription, both served by
// the whisper-server on the PC over the tailnet. Live monitoring is chunked:
// the capture tap accumulates each speaker's decoded mono PCM and a flush
// cycle every VOICE_TRANSCRIPT_FLUSH_SECONDS transcribes what accumulated,
// so lines land in the thread roughly one flush behind speech. Per-speaker
// accumulation gives true attribution with no diarization guesswork.

const logger = require('../logger');
const { setTap, clearTap, getCaptureState } = require('./capture');
const { transcribeWav, transcribeWavVerbose } = require('./whisper_client');
const { pcmToWav, resampleMonoPcm, wavToMonoPcm } = require('./wav');
const {
    VOICE_EVIDENCE_CHANNEL_ID, VOICE_MONITOR_MAX_SPEAKERS, VOICE_TRANSCRIPT_FLUSH_SECONDS,
} = require('../../config/constants');

// 48kHz mono 16-bit is 96,000 bytes per second. A flush needs at least half
// a second of speech to be worth a request; a speaker may hold at most 60
// seconds if flushes stall, then further audio is dropped.
const MIN_FLUSH_BYTES = 48000;
const MAX_ACCUM_BYTES = 96000 * 60;

// channelId -> { thread, speakers: Map<userId, { name, chunks, bytes }>,
//                pending: [], flushTimer, flushing, guild }
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

// Contained mutation on the speaker accumulator, same pattern as the capture
// registry. Returns whether the chunk fit under the cap.
const appendPcm = (speaker, pcm, maxBytes = MAX_ACCUM_BYTES) => {
    if (speaker.bytes + pcm.length > maxBytes) return false;
    speaker.chunks.push(pcm);
    speaker.bytes += pcm.length;
    return true;
};

const takePcm = (speaker, minBytes = MIN_FLUSH_BYTES) => {
    if (speaker.bytes < minBytes) return null;
    const pcm = Buffer.concat(speaker.chunks.splice(0, speaker.chunks.length), speaker.bytes);
    speaker.bytes = 0;
    return pcm;
};

const postBatches = async (monitor, lines) => {
    for (const content of batchTranscriptLines(lines)) {
        await monitor.thread.send({ content, allowedMentions: { parse: [] } }).catch((error) => {
            logger.error('[Voice Mod] Transcript post failed:', error);
        });
    }
};

const speakerName = async (monitor, userId) => {
    const member = await monitor.guild.members.fetch(userId).catch(() => null);
    return member?.displayName || `user ${userId}`;
};

// Transcribe every speaker's accumulated audio, queue the lines, and post
// them. Guarded against overlapping runs: a slow whisper round must not race
// the next timer tick.
const flushMonitor = async (channelId, { minBytes = MIN_FLUSH_BYTES } = {}) => {
    const monitor = monitors.get(channelId);
    if (!monitor || monitor.flushing) return;
    monitor.flushing = true;
    try {
        for (const [userId, speaker] of monitor.speakers) {
            const pcm48 = takePcm(speaker, minBytes);
            if (!pcm48) continue;
            const wav = pcmToWav(resampleMonoPcm(pcm48, 48000, 16000), { sampleRate: 16000, channels: 1 });
            const result = await transcribeWav(wav);
            if (result.ok && result.text) {
                monitor.pending.push({ name: speaker.name || `user ${userId}`, text: result.text });
            } else if (!result.ok) {
                logger.error(`[Voice Mod] Live transcription failed for ${userId} in ${channelId}: ${result.reason}`);
            }
        }
        if (monitor.pending.length > 0) {
            await postBatches(monitor, monitor.pending.splice(0, monitor.pending.length));
        }
    } finally {
        monitor.flushing = false;
    }
};

const startMonitoring = async ({ client, channelId, startedById }) => {
    if (!process.env.WHISPER_SERVER_URL) return { ok: false, reason: 'unconfigured' };
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
        thread, speakers: new Map(), pending: [], flushTimer: null, flushing: false,
        guild: evidenceChannel.guild,
    };
    monitors.set(channelId, monitor);
    monitor.flushTimer = setInterval(() => { void flushMonitor(channelId); }, VOICE_TRANSCRIPT_FLUSH_SECONDS * 1000);
    if (typeof monitor.flushTimer.unref === 'function') monitor.flushTimer.unref();

    const tapInstalled = setTap(channelId, (userId, monoPcm) => {
        let speaker = monitor.speakers.get(userId);
        if (!speaker) {
            if (monitor.speakers.size >= VOICE_MONITOR_MAX_SPEAKERS) return;
            speaker = { name: null, chunks: [], bytes: 0 };
            monitor.speakers.set(userId, speaker);
            void speakerName(monitor, userId).then((name) => { speaker.name = name; });
        }
        appendPcm(speaker, monoPcm);
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
    clearInterval(monitor.flushTimer);
    clearTap(channelId);
    // Final drain with no minimum so closing words are not lost, then drop
    // the registry entry.
    await flushMonitor(channelId, { minBytes: 1 }).catch((error) => {
        logger.error(`[Voice Mod] Final flush failed for ${channelId}:`, error);
    });
    monitors.delete(channelId);
    monitor.speakers.clear();
    await monitor.thread.send({ content: 'Monitoring stopped.', allowedMentions: { parse: [] } }).catch(() => {});
    logger.info(`[Voice Mod] Monitoring stopped for channel ${channelId}.`);
};

// Speaker-attributed transcription of a finished clip. Each speaker's own
// silence-padded 48k track is resampled and transcribed separately, so
// segment start times are clip offsets and attribution is exact rather than
// diarization guesses. Returns [] when unconfigured or on failure: the clip
// must post either way.
const transcribeClipSpeakers = async (userWavs, namesByUserId) => {
    if (!process.env.WHISPER_SERVER_URL) return [];
    try {
        const perUser = await Promise.all([...userWavs].map(async ([userId, wav]) => {
            const parsed = wavToMonoPcm(wav);
            if (!parsed) return [];
            const wav16 = pcmToWav(
                resampleMonoPcm(parsed.pcm, parsed.sampleRate, 16000),
                { sampleRate: 16000, channels: 1 }
            );
            const result = await transcribeWavVerbose(wav16);
            if (!result.ok) {
                logger.error(`[Voice Mod] Clip transcription failed for ${userId}: ${result.reason}`);
                return [];
            }
            const name = namesByUserId.get(userId) || `user ${userId}`;
            return result.segments.map((segment) => ({ start: segment.start, name, text: segment.text }));
        }));
        return perUser.flat();
    } catch (error) {
        logger.error('[Voice Mod] Clip transcription failed:', error);
        return [];
    }
};

// Pure formatter: time-sorted "[m:ss] **Name:** text" lines, truncated at
// maxLen without splitting a line.
const formatClipTranscript = (lines, maxLen = 1500) => {
    const sorted = [...lines].sort((a, b) => a.start - b.start);
    const rendered = sorted.map(({ start, name, text }) => {
        const seconds = Math.max(0, Math.round(start));
        return `[${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}] **${name}:** ${text}`;
    });
    let out = '';
    for (const line of rendered) {
        const next = out ? `${out}\n${line}` : line;
        if (next.length > maxLen) return `${out}\n... (truncated)`;
        out = next;
    }
    return out;
};

module.exports = {
    batchTranscriptLines, isMonitoring, startMonitoring, stopMonitoring,
    transcribeClipSpeakers, formatClipTranscript, appendPcm, takePcm,
};
