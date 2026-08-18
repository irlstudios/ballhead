'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { buildEvidenceSections } = require('../utils/voice_moderation/evidence_post');

const sample = () => buildEvidenceSections({
    title: 'Voice Flag',
    kicker: 'Automatic detection in a public room',
    mentionLine: '<@&modrole>',
    fields: [
        ['Room', '<#123>'],
        ['Speaker', '<@456>'],
        ['Matched', '`kys`'],
    ],
    transcript: 'go kys buddy\nsecond line',
    actionsTaken: ['server muted'],
    actionFailures: ['blacklist failed: role above bot'],
});

test('header section carries title, kicker, and mention', () => {
    const sections = sample();
    assert.match(sections[0], /## Voice Flag/);
    assert.match(sections[0], /-# Automatic detection in a public room/);
    assert.match(sections[0], /<@&modrole>/);
});

test('fields render as bold label rows', () => {
    const sections = sample();
    assert.match(sections[1], /\*\*Room\*\*\n<#123>/);
    assert.match(sections[1], /\*\*Speaker\*\*\n<@456>/);
});

test('transcript is quoted line by line', () => {
    const sections = sample();
    assert.match(sections[2], /### What was said/);
    assert.match(sections[2], /> go kys buddy/);
    assert.match(sections[2], /> second line/);
});

test('actions section shows both outcomes and failures', () => {
    const sections = sample();
    assert.match(sections[3], /### Bot action/);
    assert.match(sections[3], /server muted/);
    assert.match(sections[3], /blacklist failed: role above bot/);
});

test('no actions yields a none-taken line, absent transcript drops the section', () => {
    const sections = buildEvidenceSections({
        title: 'T', kicker: 'K', fields: [['A', 'b']], actionsTaken: [], actionFailures: [],
    });
    assert.strictEqual(sections.length, 3);
    assert.match(sections[2], /No action taken/);
});
