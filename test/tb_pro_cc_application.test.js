'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const modalConfig = require('../modals/modalConfig');
const constants = require('../config/constants');
const applyCommand = require('../commands/general_applications/apply_tb_pro_cc');
const applyStatus = require('../commands/general_applications/apply_status');

const modal = modalConfig.tbProCcApplicationModal;

test('TB PRO CC modal exists with Discord-legal fields', () => {
    assert.ok(modal, 'tbProCcApplicationModal missing from modalConfig');
    assert.ok(modal.fields.length <= 5, 'Discord modals allow at most 5 inputs');
    for (const field of modal.fields) {
        assert.ok(['Short', 'Paragraph'].includes(field.style), `bad style: ${field.style}`);
        assert.ok(field.label.length <= 45, `label too long (${field.label.length}): ${field.label}`);
    }
});

test('field ids match what the handler reads', () => {
    assert.deepStrictEqual(modal.fields.map((f) => f.id), [
        'tbpccMainLink',
        'tbpccBestClip',
        'tbpccMotivation',
        'tbpccCommunity',
    ]);
});

test('constants hold the TB PRO CC role, channel and eligible roles', () => {
    assert.strictEqual(constants.TB_PRO_CC_ROLE_ID, '1268421645501071380');
    assert.strictEqual(constants.TB_PRO_CC_APPLICATIONS_CHANNEL_ID, '1565059143134613614');
    assert.deepStrictEqual(constants.TB_PRO_CC_ELIGIBLE_ROLE_IDS, ['1256318001796485250', '1256318239097622651']);
});

test('command name fits Discord 32-char limit', () => {
    const json = applyCommand.data.toJSON();
    assert.strictEqual(json.name, 'apply-tb-pro-cc');
    assert.ok(json.name.length <= 32);
});

test('TB PRO CC shows up in /apply-status', () => {
    assert.ok(applyStatus.PROGRAMS.some((p) => p.name === 'TB PRO CC'));
});

const commandInteraction = (roleIds) => {
    const state = { reply: null, modalShown: null };
    return {
        state,
        interaction: {
            user: { id: '42' },
            guild: { members: { fetch: async () => ({ roles: { cache: new Set(roleIds) } }) } },
            reply: async (payload) => { state.reply = payload; },
            showModal: async (m) => { state.modalShown = m; },
        },
    };
};

test('members without Sponsored or Top Active CC are turned away', async () => {
    const { state, interaction } = commandInteraction(['999']);
    await applyCommand.execute(interaction);
    assert.strictEqual(state.modalShown, null);
    assert.ok(JSON.stringify(state.reply).includes('Role Required'));
});

test('existing TB PRO CC members are turned away', async () => {
    const { state, interaction } = commandInteraction([constants.TB_PRO_CC_ROLE_ID, constants.TB_PRO_CC_ELIGIBLE_ROLE_IDS[0]]);
    await applyCommand.execute(interaction);
    assert.strictEqual(state.modalShown, null);
    assert.ok(JSON.stringify(state.reply).includes('Already TB PRO CC'));
});

test('either eligible role opens the form', async () => {
    for (const roleId of constants.TB_PRO_CC_ELIGIBLE_ROLE_IDS) {
        const { state, interaction } = commandInteraction([roleId]);
        await applyCommand.execute(interaction);
        assert.ok(state.modalShown, `role ${roleId} should open the modal`);
        assert.strictEqual(state.reply, null);
    }
});
