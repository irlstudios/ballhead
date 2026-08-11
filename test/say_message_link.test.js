'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parseMessageLink } = require('../commands/moderation/say_command');

test('parses a standard message link', () => {
    assert.deepStrictEqual(
        parseMessageLink('https://discord.com/channels/752216589792706621/828618109794385970/1402000000000000000'),
        { guildId: '752216589792706621', channelId: '828618109794385970', messageId: '1402000000000000000' },
    );
});

test('parses ptb, canary, and legacy discordapp hosts', () => {
    for (const host of ['ptb.discord.com', 'canary.discord.com', 'discordapp.com']) {
        const parsed = parseMessageLink(`https://${host}/channels/1/2/3`);
        assert.deepStrictEqual(parsed, { guildId: '1', channelId: '2', messageId: '3' }, host);
    }
});

test('tolerates surrounding whitespace', () => {
    assert.ok(parseMessageLink('  https://discord.com/channels/1/2/3  '));
});

test('rejects non-message links and junk', () => {
    for (const junk of [
        'https://discord.com/channels/1/2',
        'https://example.com/channels/1/2/3',
        'https://discord.com/channels/a/b/c',
        'hello',
        '',
        null,
    ]) {
        assert.strictEqual(parseMessageLink(junk), null, String(junk));
    }
});
