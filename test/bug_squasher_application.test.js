'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const modalConfig = require('../modals/modalConfig');
const applyCommand = require('../commands/general_applications/apply_bug_squasher');

const modal = modalConfig.bugSquasherApplicationModal;

test('bug squasher modal exists with exactly 5 fields', () => {
    assert.ok(modal, 'bugSquasherApplicationModal missing from modalConfig');
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
        'cbsRequirementsAware',
        'cbsNoGuarantee',
        'cbsTosAware',
        'cbsMotivation',
        'cbsValue',
    ]);
});

test('command name fits Discord 32-char limit and matches the modal', () => {
    const json = applyCommand.data.toJSON();
    assert.strictEqual(json.name, 'apply-for-bug-squasher');
    assert.ok(json.name.length <= 32);
});
