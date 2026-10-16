'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { pcmToWav, resampleMonoPcm, wavToMonoPcm } = require('../utils/wav');

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
