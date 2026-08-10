'use strict';

// Builds the incident WAV from a capture's ring buffers. Decoding is injected
// so tests exercise the windowing and mixing without touching libopus.

const { OpusEncoder } = require('@discordjs/opus');
const { packetsBetween } = require('./buffers');
const { mixToMonoPcm, pcmToWav } = require('./wav');
const { getCaptureState } = require('./capture');

const buildClip = ({ store, decodeForUser, durationSeconds, now }) => {
    const windowEndMs = now;
    const windowStartMs = windowEndMs - durationSeconds * 1000;
    const packetsByUser = packetsBetween(store, windowStartMs, windowEndMs);
    if (packetsByUser.size === 0) return null;

    // Mix user-by-user so each user's decoder keeps its own opus stream state.
    // Per-user WAVs ride along for speaker-attributed transcription; they are
    // silence-padded to the window so utterance times are clip offsets.
    // ponytail: synchronous mix blocks the event loop a few hundred ms on a
    // worst-case clip; move to a worker thread if clipping ever gets frequent.
    let mixed = null;
    const userWavs = new Map();
    for (const [userId, entries] of packetsByUser) {
        const single = new Map([[userId, entries]]);
        const userPcm = mixToMonoPcm({
            packetsByUser: single, windowStartMs, windowEndMs, decode: decodeForUser(userId),
        });
        userWavs.set(userId, pcmToWav(userPcm, { sampleRate: 48000, channels: 1 }));
        if (!mixed) {
            mixed = Buffer.from(userPcm);
        } else {
            for (let i = 0; i < mixed.length; i += 2) {
                const sum = mixed.readInt16LE(i) + userPcm.readInt16LE(i);
                mixed.writeInt16LE(Math.max(-32768, Math.min(32767, sum)), i);
            }
        }
    }
    return {
        wav: pcmToWav(mixed, { sampleRate: 48000, channels: 1 }),
        windowStartMs,
        windowEndMs,
        participantIds: [...packetsByUser.keys()],
        userWavs,
    };
};

// Fresh OpusEncoder per user per clip is deliberate: opus decoder state is
// stream-positional and the buffered packets are that stream.
const clipFromCapture = ({ channelId, durationSeconds }) => {
    const state = getCaptureState(channelId);
    if (!state) return null;
    return buildClip({
        store: state.store,
        decodeForUser: () => {
            const decoder = new OpusEncoder(48000, 2);
            return (packet) => decoder.decode(packet);
        },
        durationSeconds,
        now: Date.now(),
    });
};

module.exports = { buildClip, clipFromCapture };
