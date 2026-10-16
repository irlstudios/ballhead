'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { MessageFlags } = require('discord.js');

const listener = require('../events/cc_progress_question_listener');
const { buildGuidePage } = require('../utils/product_guide');

const COMMANDS = [
    require('../commands/content_creator/cc_apply_instagram'),
    require('../commands/content_creator/cc_check_account'),
    require('../commands/content_creator/cc_get_quality_score'),
];

const textOf = (payload) => JSON.stringify(payload.components.map((c) => c.toJSON()));

function assertRedirect(text) {
    assert.match(text, /GC mobile app/);
    assert.match(text, /Instagram/);
    assert.match(text, /\/verify/);
    assert.match(text, /\/cc_status/);
    assert.ok(!text.includes('/cc apply-instagram'), 'must not send people back to the old command');
}

for (const command of COMMANDS) {
    test(`/${command.data.name} replies privately with the GC mobile redirect`, async () => {
        const replies = [];
        await command.execute({ reply: async (payload) => replies.push(payload) });

        assert.strictEqual(replies.length, 1);
        assert.strictEqual(replies[0].flags, MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
        assertRedirect(textOf(replies[0]));
    });

    test(`/${command.data.name} no longer takes options`, () => {
        assert.deepStrictEqual(command.data.toJSON().options ?? [], []);
    });
}

function fakeMessage(content, { bot = false } = {}) {
    const replies = [];
    return {
        replies,
        content,
        author: { bot, id: '111', tag: 'user#0001' },
        channel: { isDMBased: () => false },
        reply: async (payload) => replies.push(payload),
    };
}

test('CC questions in chat get the GC mobile redirect', async () => {
    for (const content of ['how do i get cc?', 'Why didn\'t I get content creator', 'my cc progress']) {
        const message = fakeMessage(content);
        await listener.execute(message);
        assert.strictEqual(message.replies.length, 1, content);
        assertRedirect(textOf(message.replies[0]));
    }
});

test('unrelated chat and bot messages are ignored', async () => {
    const unrelated = fakeMessage('anyone want to run a game');
    await listener.execute(unrelated);
    assert.strictEqual(unrelated.replies.length, 0);

    const fromBot = fakeMessage('how do i get cc', { bot: true });
    await listener.execute(fromBot);
    assert.strictEqual(fromBot.replies.length, 0);
});

test('the guide points creators to the GC mobile app', () => {
    const text = buildGuidePage('content-creator').lines.join('\n');
    assertRedirect(text);
});
