'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
    parseDynoModerationEmbed,
    extractEmbedData,
} = require('../utils/dyno_moderation_parser');

// --- Title parsing -----------------------------------------------------------

test('parses a Mute case title into case number, action, and target name', () => {
    const result = parseDynoModerationEmbed({
        title: 'Case 20244 | Mute | bob1102976',
        fields: [],
    });
    assert.ok(result);
    assert.strictEqual(result.caseNumber, '20244');
    assert.strictEqual(result.action, 'Mute');
    assert.strictEqual(result.targetName, 'bob1102976');
});

test('parses a Warn case title', () => {
    const result = parseDynoModerationEmbed({
        title: 'Case 20187 | Warn | movinoctane',
        fields: [],
    });
    assert.ok(result);
    assert.strictEqual(result.action, 'Warn');
    assert.strictEqual(result.targetName, 'movinoctane');
});

test('parses a Ban case title', () => {
    const result = parseDynoModerationEmbed({
        title: 'Case 20245 | Ban | jitwilding',
        fields: [],
    });
    assert.ok(result);
    assert.strictEqual(result.action, 'Ban');
    assert.strictEqual(result.targetName, 'jitwilding');
});

test('normalises action casing to canonical form', () => {
    const result = parseDynoModerationEmbed({
        title: 'Case 1 | mute | someone',
        fields: [],
    });
    assert.strictEqual(result.action, 'Mute');
});

test('returns null for moderation actions outside Mute/Warn/Ban', () => {
    assert.strictEqual(
        parseDynoModerationEmbed({ title: 'Case 5 | Kick | someone', fields: [] }),
        null
    );
    assert.strictEqual(
        parseDynoModerationEmbed({ title: 'Case 6 | Unmute | someone', fields: [] }),
        null
    );
});

test('returns null when the title is missing or not a Dyno case', () => {
    assert.strictEqual(parseDynoModerationEmbed({ fields: [] }), null);
    assert.strictEqual(
        parseDynoModerationEmbed({ title: 'Some random embed', fields: [] }),
        null
    );
});

test('returns null when the embed itself is missing', () => {
    assert.strictEqual(parseDynoModerationEmbed(null), null);
    assert.strictEqual(parseDynoModerationEmbed(undefined), null);
});

test('parses the Case line from the embed author name (real Dyno shape)', () => {
    const result = parseDynoModerationEmbed({
        title: null,
        authorName: 'Case 20248 | Warn | fwsuperman',
        fields: [
            { name: 'User', value: '<@604412539425652785>' },
            { name: 'Moderator', value: '<@781397829808553994>' },
            { name: 'Reason', value: 'testing testing testing' },
        ],
        footerText: 'ID: 604412539425652785',
    });
    assert.ok(result);
    assert.strictEqual(result.caseNumber, '20248');
    assert.strictEqual(result.action, 'Warn');
    assert.strictEqual(result.targetName, 'fwsuperman');
    assert.strictEqual(result.userId, '604412539425652785');
    assert.strictEqual(result.moderator, '<@781397829808553994>');
    assert.strictEqual(result.reason, 'testing testing testing');
    assert.strictEqual(result.length, null);
});

test('prefers the title but falls back to the author name for the case line', () => {
    const fromTitle = parseDynoModerationEmbed({
        title: 'Case 1 | Ban | viaTitle',
        authorName: 'not a case line',
        fields: [],
    });
    assert.strictEqual(fromTitle.targetName, 'viaTitle');

    const fromAuthor = parseDynoModerationEmbed({
        title: 'Moderation Log',
        authorName: 'Case 2 | Ban | viaAuthor',
        fields: [],
    });
    assert.strictEqual(fromAuthor.targetName, 'viaAuthor');
});

// --- User id extraction ------------------------------------------------------

test('extracts the user id from a mention in the User field', () => {
    const result = parseDynoModerationEmbed({
        title: 'Case 20244 | Mute | bob1102976',
        fields: [{ name: 'User', value: '<@1330740662181564427>' }],
    });
    assert.strictEqual(result.userId, '1330740662181564427');
});

test('extracts the user id from a nickname mention (<@!id>)', () => {
    const result = parseDynoModerationEmbed({
        title: 'Case 20244 | Mute | bob1102976',
        fields: [{ name: 'User', value: '<@!1330740662181564427>' }],
    });
    assert.strictEqual(result.userId, '1330740662181564427');
});

test('falls back to the footer ID when the User field has only a display name', () => {
    const result = parseDynoModerationEmbed({
        title: 'Case 20245 | Ban | jitwilding',
        fields: [{ name: 'User', value: '@Bob11' }],
        footerText: 'ID: 1490882028152029195',
    });
    assert.strictEqual(result.userId, '1490882028152029195');
});

test('falls back to an ID found in the description text', () => {
    const result = parseDynoModerationEmbed({
        title: 'Case 20245 | Ban | jitwilding',
        fields: [{ name: 'User', value: '@Bob11' }],
        description: 'Action taken. ID: 1490882028152029195',
    });
    assert.strictEqual(result.userId, '1490882028152029195');
});

test('prefers the mention id over the footer id', () => {
    const result = parseDynoModerationEmbed({
        title: 'Case 20244 | Mute | bob1102976',
        fields: [{ name: 'User', value: '<@1330740662181564427>' }],
        footerText: 'ID: 9999999999999999999',
    });
    assert.strictEqual(result.userId, '1330740662181564427');
});

test('returns a null user id when no mention or footer id is present', () => {
    const result = parseDynoModerationEmbed({
        title: 'Case 20245 | Ban | jitwilding',
        fields: [{ name: 'User', value: '@Bob11' }],
    });
    assert.strictEqual(result.userId, null);
});

// --- Other fields ------------------------------------------------------------

test('extracts moderator, length, and reason fields', () => {
    const result = parseDynoModerationEmbed({
        title: 'Case 20244 | Mute | bob1102976',
        fields: [
            { name: 'User', value: '<@1330740662181564427>' },
            { name: 'Moderator', value: '@Superman' },
            { name: 'Length', value: '2 hours' },
            { name: 'Reason', value: 'spamming' },
        ],
    });
    assert.strictEqual(result.moderator, '@Superman');
    assert.strictEqual(result.length, '2 hours');
    assert.strictEqual(result.reason, 'spamming');
});

test('matches field names case-insensitively and trims whitespace', () => {
    const result = parseDynoModerationEmbed({
        title: 'Case 20244 | Mute | bob1102976',
        fields: [
            { name: ' moderator ', value: '@Superman' },
            { name: 'REASON', value: 'being rude' },
        ],
    });
    assert.strictEqual(result.moderator, '@Superman');
    assert.strictEqual(result.reason, 'being rude');
});

test('length is null when no Length field is present (e.g. Warn/Ban)', () => {
    const result = parseDynoModerationEmbed({
        title: 'Case 20187 | Warn | movinoctane',
        fields: [
            { name: 'User', value: '<@1330740662181564427>' },
            { name: 'Reason', value: 'spamming' },
        ],
    });
    assert.strictEqual(result.length, null);
});

test('missing optional fields are null rather than undefined', () => {
    const result = parseDynoModerationEmbed({
        title: 'Case 20187 | Warn | movinoctane',
        fields: [],
    });
    assert.strictEqual(result.moderator, null);
    assert.strictEqual(result.reason, null);
    assert.strictEqual(result.length, null);
    assert.strictEqual(result.userId, null);
});

// --- extractEmbedData --------------------------------------------------------

test('extractEmbedData normalises a discord.js embed shape', () => {
    const embed = {
        title: 'Case 20244 | Mute | bob1102976',
        description: 'desc',
        fields: [{ name: 'User', value: '<@1>', inline: true }],
        footer: { text: 'ID: 42', iconURL: 'x' },
    };
    const plain = extractEmbedData(embed);
    assert.strictEqual(plain.title, 'Case 20244 | Mute | bob1102976');
    assert.strictEqual(plain.description, 'desc');
    assert.strictEqual(plain.footerText, 'ID: 42');
    assert.deepStrictEqual(plain.fields, [{ name: 'User', value: '<@1>' }]);
});

test('extractEmbedData captures the embed author name', () => {
    const plain = extractEmbedData({ author: { name: 'Case 1 | Ban | x' }, fields: [] });
    assert.strictEqual(plain.authorName, 'Case 1 | Ban | x');
});

test('extractEmbedData handles a missing footer and author gracefully', () => {
    const plain = extractEmbedData({ title: 't', fields: undefined, footer: null });
    assert.strictEqual(plain.footerText, null);
    assert.strictEqual(plain.authorName, null);
    assert.deepStrictEqual(plain.fields, []);
});
