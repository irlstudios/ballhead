'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const modalConfig = require('../modals/modalConfig');
const applyCommand = require('../commands/general_applications/apply_emh');
const ffApplyCommand = require('../commands/general_applications/apply_ff_official');
const { isHttpUrl } = require('../utils/applications');
const { OFFICIAL_ACTIVE_ROLE_ID, OFFICIAL_SPONSORED_ROLE_ID, FF_OFFICIAL_ROLE_ID } = require('../config/constants');

const modal = modalConfig.emhApplicationModal;

test('EMH modal exists with exactly 5 fields', () => {
    assert.ok(modal, 'emhApplicationModal missing from modalConfig');
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
        'emhIgn',
        'emhHostingDuration',
        'emhRulesRead',
        'emhMotivation',
        'emhYoutubeLink',
    ]);
});

test('command name fits Discord 32-char limit', () => {
    const json = applyCommand.data.toJSON();
    assert.strictEqual(json.name, 'apply-emh');
    assert.ok(json.name.length <= 32);
});

test('every EMH field caps its length so the review card stays sendable', () => {
    let total = 0;
    for (const field of modal.fields) {
        assert.ok(Number.isInteger(field.maxLength) && field.maxLength > 0, `${field.id} needs maxLength`);
        total += field.maxLength;
    }
    assert.ok(total < 3500, 'combined answers must fit a 4000-char text display with headers');
});

// Hosts record on Quest, so a Meta share link is as valid as YouTube; leads
// watch the video either way.
test('the video link accepts any full http(s) URL, not only YouTube', () => {
    assert.ok(isHttpUrl('https://www.youtube.com/watch?v=abc123'));
    assert.ok(isHttpUrl('  https://youtu.be/abc123  '));
    assert.ok(isHttpUrl('https://fb.watch/abc123/'));
    assert.ok(isHttpUrl('https://www.meta.com/horizon/video/123'));
    assert.ok(!isHttpUrl('javascript:youtube.com/'));
    assert.ok(!isHttpUrl('my video is on youtube'));
    assert.ok(!isHttpUrl(''));
});

test('the video field does not tell applicants it must be YouTube', () => {
    const field = modal.fields.find((f) => f.id === 'emhYoutubeLink');
    assert.doesNotMatch(field.label, /youtube/i);
});

const ffInteractionMock = (roleIds = []) => {
    const state = { replied: null, modalShown: false };
    const member = { roles: { cache: { has: (id) => roleIds.includes(id) } } };
    return {
        state,
        interaction: {
            user: { id: '42' },
            guild: { members: { fetch: async () => member } },
            reply: async (payload) => { state.replied = payload; },
            showModal: async () => { state.modalShown = true; },
        },
    };
};

test('FF Official application opens for an Active Official', async () => {
    const { state, interaction } = ffInteractionMock([OFFICIAL_ACTIVE_ROLE_ID]);

    await ffApplyCommand.execute(interaction);

    assert.ok(state.modalShown, 'an eligible official should get the form');
    assert.strictEqual(state.replied, null);
});

test('FF Official application opens for a Sponsored Official', async () => {
    const { state, interaction } = ffInteractionMock([OFFICIAL_SPONSORED_ROLE_ID]);

    await ffApplyCommand.execute(interaction);

    assert.ok(state.modalShown, 'a Sponsored Official should get the form');
});

test('FF Official application is refused without an Official role', async () => {
    const { state, interaction } = ffInteractionMock([]);

    await ffApplyCommand.execute(interaction);

    assert.ok(!state.modalShown, 'modal must not open for an ineligible member');
    assert.ok(JSON.stringify(state.replied).includes('Only Active Officials and Sponsored Officials'));
});

test('FF Official application is refused for someone already holding the role', async () => {
    const { state, interaction } = ffInteractionMock([FF_OFFICIAL_ROLE_ID]);

    await ffApplyCommand.execute(interaction);

    assert.ok(!state.modalShown, 'an existing FF Official cannot re-apply');
    assert.ok(JSON.stringify(state.replied).includes('already an FF Official'));
});
