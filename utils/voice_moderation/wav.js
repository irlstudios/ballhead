'use strict';

// Turns buffered opus packets into a shareable mono WAV without ffmpeg. Discord
// only sends packets while a user speaks, so the mix places each decoded packet
// at its arrival offset and leaves everything else as silence. Arrival time is
// accurate to network jitter, which is fine for evidence.

const SAMPLES_PER_MS = 48;

const mixToMonoPcm = ({ packetsByUser, windowStartMs, windowEndMs, decode }) => {
    const totalSamples = Math.max(0, Math.floor((windowEndMs - windowStartMs) * SAMPLES_PER_MS));
    const mix = new Int32Array(totalSamples);
    for (const entries of packetsByUser.values()) {
        for (const { at, packet } of entries) {
            const pcm = decode(packet);
            const startSample = Math.floor((at - windowStartMs) * SAMPLES_PER_MS);
            const frames = Math.floor(pcm.length / 4);
            for (let i = 0; i < frames; i += 1) {
                const target = startSample + i;
                if (target < 0 || target >= totalSamples) continue;
                const left = pcm.readInt16LE(i * 4);
                const right = pcm.readInt16LE(i * 4 + 2);
                mix[target] += Math.round((left + right) / 2);
            }
        }
    }
    const out = Buffer.alloc(totalSamples * 2);
    for (let i = 0; i < totalSamples; i += 1) {
        out.writeInt16LE(Math.max(-32768, Math.min(32767, mix[i])), i * 2);
    }
    return out;
};

const pcmToWav = (pcm, { sampleRate = 48000, channels = 1 } = {}) => {
    const blockAlign = channels * 2;
    const header = Buffer.alloc(44);
    header.write('RIFF', 0, 'ascii');
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write('WAVE', 8, 'ascii');
    header.write('fmt ', 12, 'ascii');
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * blockAlign, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36, 'ascii');
    header.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([header, pcm]);
};

module.exports = { mixToMonoPcm, pcmToWav };
