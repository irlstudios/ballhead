'use strict';

// Drains each speaker's buffered opus since the last cycle into a 16 kHz
// mono WAV for whisper. The window is trimmed to each speaker's own packet
// span so silence is not shipped. Decoding is injected, clipper-style.

const { packetsBetween } = require('./buffers');
const { mixToMonoPcm, pcmToWav, resampleMonoPcm } = require('./wav');
const { VOICE_CHUNK_MIN_PACKETS } = require('../../config/constants');

const drainUserChunks = ({ store, decodeForUser, sinceMs, nowMs, minPackets = VOICE_CHUNK_MIN_PACKETS, users = null }) => {
    const wanted = users ? new Set(users) : null;
    const chunks = new Map();
    for (const [userId, entries] of packetsBetween(store, sinceMs, nowMs)) {
        if (wanted && !wanted.has(userId)) continue;
        if (entries.length < minPackets) continue;
        const windowStartMs = entries[0].at;
        const windowEndMs = entries[entries.length - 1].at + 20;
        const pcm48 = mixToMonoPcm({
            packetsByUser: new Map([[userId, entries]]),
            windowStartMs, windowEndMs,
            decode: decodeForUser(userId),
        });
        const pcm16 = resampleMonoPcm(pcm48, 48000, 16000);
        chunks.set(userId, pcmToWav(pcm16, { sampleRate: 16000, channels: 1 }));
    }
    return chunks;
};

module.exports = { drainUserChunks };
