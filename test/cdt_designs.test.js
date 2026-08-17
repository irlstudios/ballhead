'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { groupCommandsByDomain } = require('../utils/command_domains');
const {
    parseMessageLink,
    fileExtension,
    isImageAttachment,
    toFilePayloads,
    toPreviewPayloads,
    desiredTags,
} = require('../utils/cdt_designs');
const {
    CDT_FORUM_TAGS,
    CDT_POPULAR_TAG_ID,
    CDT_MOST_DOWNLOADED_TAG_ID,
    CDT_POPULAR_THRESHOLD,
} = require('../config/constants');

const { dedupeNames, designPrefix, sanitizeName } = require('../utils/cdt_storage');
const approveCommand = require('../commands/cdt/cdt_approve');
const updateCommand = require('../commands/cdt/cdt_update');
const removeCommand = require('../commands/cdt/cdt_remove');
const statsCommand = require('../commands/cdt/cdt_stats');

test('parseMessageLink extracts guild, channel, and message ids', () => {
    const link = 'https://discord.com/channels/111/222/333';
    assert.deepStrictEqual(parseMessageLink(link), { guildId: '111', channelId: '222', messageId: '333' });
    assert.deepStrictEqual(parseMessageLink('  https://discordapp.com/channels/1/2/3  '), { guildId: '1', channelId: '2', messageId: '3' });
    assert.strictEqual(parseMessageLink('https://discord.com/channels/111/222'), null);
    assert.strictEqual(parseMessageLink('not a link'), null);
    assert.strictEqual(parseMessageLink(''), null);
    assert.strictEqual(parseMessageLink(undefined), null);
});

test('fileExtension falls back to png and lowercases', () => {
    assert.strictEqual(fileExtension('court.JSON'), 'json');
    assert.strictEqual(fileExtension('preview.PNG'), 'png');
    assert.strictEqual(fileExtension('noextension'), 'png');
    assert.strictEqual(fileExtension(''), 'png');
});

test('isImageAttachment uses content type first, extension as fallback', () => {
    assert.ok(isImageAttachment({ contentType: 'image/png', name: 'a.bin' }));
    assert.ok(isImageAttachment({ contentType: null, name: 'shot.jpeg' }));
    assert.ok(!isImageAttachment({ contentType: 'application/json', name: 'court.json' }));
    assert.ok(!isImageAttachment({ contentType: null, name: 'court.json' }));
});

const mockMessage = (attachments) => ({
    attachments: new Map(attachments.map((a, i) => [String(i), a])),
});

test('toPreviewPayloads keeps only images and renames them deterministically', () => {
    const message = mockMessage([
        { contentType: 'image/png', name: 'front view.png', url: 'https://cdn/1' },
        { contentType: 'application/json', name: 'court.json', url: 'https://cdn/2' },
        { contentType: 'image/jpeg', name: 'side.jpg', url: 'https://cdn/3' },
    ]);
    const previews = toPreviewPayloads(message);
    assert.deepStrictEqual(previews, [
        { attachment: 'https://cdn/1', name: 'preview-1.png' },
        { attachment: 'https://cdn/3', name: 'preview-2.jpg' },
    ]);
});

test('toFilePayloads serves every attachment with its original name', () => {
    const message = mockMessage([
        { contentType: 'image/png', name: 'front.png', url: 'https://cdn/1' },
        { contentType: 'application/json', name: 'court.json', url: 'https://cdn/2' },
    ]);
    assert.deepStrictEqual(toFilePayloads(message), [
        { attachment: 'https://cdn/1', name: 'front.png' },
        { attachment: 'https://cdn/2', name: 'court.json' },
    ]);
});

test('designPrefix versions each design\'s files under its own S3 prefix', () => {
    assert.strictEqual(designPrefix(7, 1), 'cdt-designs/7/v1/');
    assert.strictEqual(designPrefix(7, 2), 'cdt-designs/7/v2/');
});

test('dedupeNames suffixes duplicate file names so S3 keys never collide', () => {
    assert.deepStrictEqual(
        dedupeNames(['court.json', 'court.json', 'court.json', 'readme']),
        ['court.json', 'court-2.json', 'court-3.json', 'readme']
    );
    assert.deepStrictEqual(dedupeNames(['a.png', 'b.png']), ['a.png', 'b.png']);
    assert.deepStrictEqual(
        dedupeNames(['court.json', 'court.json', 'court-2.json']),
        ['court.json', 'court-2.json', 'court-2-2.json']
    );
});

test('sanitizeName keeps attachment references and S3 keys valid', () => {
    assert.strictEqual(sanitizeName('my court file.json'), 'my_court_file.json');
    assert.strictEqual(sanitizeName('court(v2)!.png'), 'court_v2__.png');
    assert.strictEqual(sanitizeName('plain-name_ok.json'), 'plain-name_ok.json');
    assert.strictEqual(sanitizeName(''), 'file');
    assert.strictEqual(sanitizeName('...'), 'file');
});

test('the four lead commands fold into a single /cdt domain command', () => {
    const grouped = groupCommandsByDomain([approveCommand, updateCommand, removeCommand, statsCommand]);
    assert.deepStrictEqual([...grouped.keys()], ['cdt']);
    const json = grouped.get('cdt').data.toJSON();
    assert.deepStrictEqual(
        json.options.map((o) => o.name).sort(),
        ['approve', 'remove', 'stats', 'update']
    );
    assert.ok(json.options.every((o) => o.type === 1), 'each command must fold to a subcommand');
});

test('approve categories match the forum content tags exactly', () => {
    const json = approveCommand.data.toJSON();
    const category = json.options.find((o) => o.name === 'category');
    assert.deepStrictEqual(
        category.choices.map((c) => c.value),
        Object.keys(CDT_FORUM_TAGS)
    );
    for (const tagId of Object.values(CDT_FORUM_TAGS)) {
        assert.match(tagId, /^\d{17,20}$/, 'tag ids must be snowflakes');
    }
});

test('desiredTags manages only Popular and Most Downloaded', () => {
    const category = '1538410400922738688';
    const manual = '999';
    // Below threshold, not top: stat tags stripped, others kept.
    assert.deepStrictEqual(
        desiredTags([category, manual, CDT_POPULAR_TAG_ID, CDT_MOST_DOWNLOADED_TAG_ID], 3, false),
        [category, manual]
    );
    // At threshold and top design: both stat tags applied once.
    assert.deepStrictEqual(
        desiredTags([category, CDT_POPULAR_TAG_ID], CDT_POPULAR_THRESHOLD, true),
        [category, CDT_POPULAR_TAG_ID, CDT_MOST_DOWNLOADED_TAG_ID]
    );
    // Never exceeds Discord's 5-tag cap.
    assert.strictEqual(desiredTags(['1', '2', '3', '4', '5'], 100, true).length, 5);
});

test('update and remove use autocomplete on the design option', () => {
    for (const command of [updateCommand, removeCommand]) {
        const json = command.data.toJSON();
        const design = json.options.find((o) => o.name === 'design');
        assert.ok(design.autocomplete, `${json.name} design option must autocomplete`);
        assert.strictEqual(typeof command.autocomplete, 'function');
    }
});
