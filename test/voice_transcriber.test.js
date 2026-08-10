'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { batchTranscriptLines } = require('../utils/voice_moderation/transcriber');

test('lines render with bold speaker names in order', () => {
    const batches = batchTranscriptLines([
        { name: 'Roy', text: 'hello there' },
        { name: 'Sam', text: 'hi' },
    ]);
    assert.deepStrictEqual(batches, ['**Roy:** hello there\n**Sam:** hi']);
});

test('batches split rather than exceed the length cap', () => {
    const lines = Array.from({ length: 10 }, (_, i) => ({ name: 'A', text: 'x'.repeat(50) + i }));
    const batches = batchTranscriptLines(lines, 120);
    assert.ok(batches.length > 1);
    for (const batch of batches) assert.ok(batch.length <= 120);
    assert.ok(batches[0].startsWith('**A:** xxx'));
});

test('a single line longer than the cap is truncated, not dropped', () => {
    const batches = batchTranscriptLines([{ name: 'A', text: 'y'.repeat(500) }], 100);
    assert.strictEqual(batches.length, 1);
    assert.ok(batches[0].length <= 100);
    assert.ok(batches[0].startsWith('**A:** yyy'));
});

test('empty input produces no batches', () => {
    assert.deepStrictEqual(batchTranscriptLines([]), []);
});

const { formatClipTranscript } = require('../utils/voice_moderation/transcriber');

test('clip transcript lines are time-sorted with mm:ss offsets and names', () => {
    const text = formatClipTranscript([
        { start: 65.4, name: 'Sam', text: 'no you are' },
        { start: 5.1, name: 'Roy', text: 'you are trash' },
    ]);
    assert.strictEqual(text, '[0:05] **Roy:** you are trash\n[1:05] **Sam:** no you are');
});

test('clip transcript truncates at the cap without splitting a line', () => {
    const lines = Array.from({ length: 30 }, (_, i) => ({ start: i, name: 'A', text: 'x'.repeat(40) }));
    const text = formatClipTranscript(lines, 200);
    assert.ok(text.length <= 200 + '\n... (truncated)'.length);
    assert.ok(text.endsWith('... (truncated)'));
});

test('empty utterances produce an empty string', () => {
    assert.strictEqual(formatClipTranscript([]), '');
});
