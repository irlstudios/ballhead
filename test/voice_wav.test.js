'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { mixToMonoPcm, pcmToWav } = require('../utils/voice_moderation/wav');

// Builds s16le stereo PCM where every L and R sample is `value`.
const stereo = (value, samples) => {
    const buf = Buffer.alloc(samples * 4);
    for (let i = 0; i < samples * 2; i += 1) buf.writeInt16LE(value, i * 2);
    return buf;
};

test('a packet lands at its time offset and gaps stay silent', () => {
    const packetsByUser = new Map([['u1', [{ at: 10, packet: 'p' }]]]);
    const pcm = mixToMonoPcm({
        packetsByUser, windowStartMs: 0, windowEndMs: 20,
        decode: () => stereo(1000, 48),
    });
    assert.strictEqual(pcm.length, 20 * 48 * 2);
    assert.strictEqual(pcm.readInt16LE(0), 0);
    const offset = 10 * 48;
    assert.strictEqual(pcm.readInt16LE(offset * 2), 1000);
    assert.strictEqual(pcm.readInt16LE((offset + 47) * 2), 1000);
    assert.strictEqual(pcm.readInt16LE((offset + 48) * 2), 0);
});

test('a packet whose decode returns null is skipped, not mixed', () => {
    const packetsByUser = new Map([['u1', [{ at: 0, packet: 'bad' }, { at: 10, packet: 'good' }]]]);
    const pcm = mixToMonoPcm({
        packetsByUser, windowStartMs: 0, windowEndMs: 20,
        decode: (p) => (p === 'bad' ? null : stereo(1000, 48)),
    });
    assert.strictEqual(pcm.readInt16LE(0), 0);
    assert.strictEqual(pcm.readInt16LE(10 * 48 * 2), 1000);
});

test('stereo is downmixed by averaging the two channels', () => {
    const packet = Buffer.alloc(4);
    packet.writeInt16LE(2000, 0);
    packet.writeInt16LE(1000, 2);
    const packetsByUser = new Map([['u1', [{ at: 0, packet }]]]);
    const pcm = mixToMonoPcm({
        packetsByUser, windowStartMs: 0, windowEndMs: 1,
        decode: (p) => p,
    });
    assert.strictEqual(pcm.readInt16LE(0), 1500);
});

test('overlapping speakers sum and clamp at int16 limits', () => {
    const packetsByUser = new Map([
        ['u1', [{ at: 0, packet: 'a' }]],
        ['u2', [{ at: 0, packet: 'b' }]],
    ]);
    const pcm = mixToMonoPcm({
        packetsByUser, windowStartMs: 0, windowEndMs: 1,
        decode: () => stereo(30000, 48),
    });
    assert.strictEqual(pcm.readInt16LE(0), 32767);
});

test('audio past the window end is truncated, not overflowed', () => {
    const packetsByUser = new Map([['u1', [{ at: 19, packet: 'p' }]]]);
    const pcm = mixToMonoPcm({
        packetsByUser, windowStartMs: 0, windowEndMs: 20,
        decode: () => stereo(500, 96),
    });
    assert.strictEqual(pcm.length, 20 * 48 * 2);
    assert.strictEqual(pcm.readInt16LE((20 * 48 - 1) * 2), 500);
});

test('the wav header is well formed for mono 48k', () => {
    const pcm = Buffer.alloc(96, 7);
    const wav = pcmToWav(pcm, { sampleRate: 48000, channels: 1 });
    assert.strictEqual(wav.length, 44 + 96);
    assert.strictEqual(wav.toString('ascii', 0, 4), 'RIFF');
    assert.strictEqual(wav.readUInt32LE(4), 36 + 96);
    assert.strictEqual(wav.toString('ascii', 8, 12), 'WAVE');
    assert.strictEqual(wav.readUInt16LE(20), 1);
    assert.strictEqual(wav.readUInt16LE(22), 1);
    assert.strictEqual(wav.readUInt32LE(24), 48000);
    assert.strictEqual(wav.readUInt32LE(28), 48000 * 2);
    assert.strictEqual(wav.readUInt16LE(32), 2);
    assert.strictEqual(wav.readUInt16LE(34), 16);
    assert.strictEqual(wav.toString('ascii', 36, 40), 'data');
    assert.strictEqual(wav.readUInt32LE(40), 96);
    assert.strictEqual(wav.readInt16LE(44), 0x0707);
});

const { resampleMonoPcm } = require('../utils/voice_moderation/wav');

test('resampling at the same rate returns identical samples', () => {
    const pcm = Buffer.alloc(8);
    [100, 200, 300, 400].forEach((v, i) => pcm.writeInt16LE(v, i * 2));
    assert.deepStrictEqual(resampleMonoPcm(pcm, 48000, 48000), pcm);
});

test('upsampling doubles the sample count and interpolates midpoints', () => {
    const pcm = Buffer.alloc(4);
    pcm.writeInt16LE(0, 0);
    pcm.writeInt16LE(1000, 2);
    const out = resampleMonoPcm(pcm, 24000, 48000);
    assert.strictEqual(out.length, 8);
    assert.strictEqual(out.readInt16LE(0), 0);
    assert.strictEqual(out.readInt16LE(2), 500);
    assert.strictEqual(out.readInt16LE(4), 1000);
});

test('non-integer ratios produce the expected output length', () => {
    const pcm = Buffer.alloc(22050 * 2);
    const out = resampleMonoPcm(pcm, 22050, 48000);
    assert.strictEqual(out.length, 48000 * 2);
});

const { wavToMonoPcm } = require('../utils/voice_moderation/wav');

test('wavToMonoPcm roundtrips pcmToWav output', () => {
    const pcm = Buffer.alloc(96, 3);
    const parsed = wavToMonoPcm(pcmToWav(pcm, { sampleRate: 22050, channels: 1 }));
    assert.strictEqual(parsed.sampleRate, 22050);
    assert.deepStrictEqual(parsed.pcm, pcm);
});

test('wavToMonoPcm rejects stereo and non-wav buffers', () => {
    assert.strictEqual(wavToMonoPcm(Buffer.from('not a wav file at all............')), null);
    const stereo = pcmToWav(Buffer.alloc(96), { sampleRate: 48000, channels: 2 });
    assert.strictEqual(wavToMonoPcm(stereo), null);
});
