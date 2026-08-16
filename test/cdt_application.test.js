'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const modalConfig = require('../modals/modalConfig');
const applyCommand = require('../commands/general_applications/apply_design_team');
const { isHttpUrl } = require('../handlers/cdt_applications');

const modal = modalConfig.communityDesignerApplicationModal;

test('CDT modal exists with exactly 5 fields', () => {
    assert.ok(modal, 'communityDesignerApplicationModal missing from modalConfig');
    assert.strictEqual(modal.fields.length, 5, 'Discord modals allow at most 5 inputs');
});

test('every field has a valid style and a Discord-legal label (<=45 chars)', () => {
    for (const field of modal.fields) {
        assert.ok(['Short', 'Paragraph'].includes(field.style), `bad style: ${field.style}`);
        assert.ok(field.label.length <= 45, `label too long (${field.label.length}): ${field.label}`);
        assert.ok(field.id && typeof field.id === 'string', 'field missing id');
    }
});

test('field ids match what the handler reads', () => {
    const ids = modal.fields.map((f) => f.id);
    assert.deepStrictEqual(ids, [
        'cdtIgn',
        'cdtChallengeHistory',
        'cdtNoAi',
        'cdtMotivation',
        'cdtPortfolioLink',
    ]);
});

test('command name fits Discord 32-char limit', () => {
    const json = applyCommand.data.toJSON();
    assert.strictEqual(json.name, 'apply-cdt');
    assert.ok(json.name.length <= 32);
});

test('every CDT field caps its length so the review card stays sendable', () => {
    let total = 0;
    for (const field of modal.fields) {
        assert.ok(Number.isInteger(field.maxLength) && field.maxLength > 0, `${field.id} needs maxLength`);
        total += field.maxLength;
    }
    assert.ok(total < 3500, 'combined answers must fit a 4000-char text display with headers');
});

test('isHttpUrl accepts real links and rejects everything else', () => {
    assert.ok(isHttpUrl('https://imgur.com/a/abc123'));
    assert.ok(isHttpUrl('  https://drive.google.com/drive/folders/abc  '));
    assert.ok(isHttpUrl('http://example.com/designs'));
    assert.ok(!isHttpUrl('javascript:alert(1)'));
    assert.ok(!isHttpUrl('ftp://example.com/file'));
    assert.ok(!isHttpUrl('my designs are on imgur'));
    assert.ok(!isHttpUrl('https://localhost/designs'));
    assert.ok(!isHttpUrl(''));
});
