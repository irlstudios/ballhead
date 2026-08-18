'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { scanTranscript } = require('../utils/voice_moderation/keyword_scan');

test('matches tier1 words case-insensitively on word boundaries', () => {
    const result = scanTranscript('I will KYS you later', { tier1: ['kys'], tier2: [] });
    assert.deepStrictEqual(result.tier1, ['kys']);
});

test('does not match inside larger words', () => {
    const result = scanTranscript('the kyshtym disaster', { tier1: ['kys'], tier2: [] });
    assert.deepStrictEqual(result.tier1, []);
});

test('matches multi-word phrases and deduplicates', () => {
    const result = scanTranscript('kill yourself. seriously kill yourself',
        { tier1: ['kill yourself'], tier2: [] });
    assert.deepStrictEqual(result.tier1, ['kill yourself']);
});

test('tier2 matches are reported separately', () => {
    const result = scanTranscript('this lobby is trash talk city',
        { tier1: [], tier2: ['trash talk'] });
    assert.deepStrictEqual(result, { tier1: [], tier2: ['trash talk'] });
});

test('uses the shipped config lists when none are passed', () => {
    const result = scanTranscript('completely benign sentence');
    assert.deepStrictEqual(result, { tier1: [], tier2: [] });
});

test('apostrophes in transcripts do not defeat matching', () => {
    const result = scanTranscript("hey, don't tell your parents about this",
        { tier1: ['dont tell your parents'], tier2: [] });
    assert.deepStrictEqual(result.tier1, ['dont tell your parents']);
});

test('curly apostrophes from smart transcription are normalized too', () => {
    const result = scanTranscript('what’s your address little man',
        { tier1: ['whats your address'], tier2: [] });
    assert.deepStrictEqual(result.tier1, ['whats your address']);
});
