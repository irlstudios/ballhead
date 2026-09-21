'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const listener = require('../events/discord_id_question_listener');
const { matchesIdQuestion } = listener;

const shouldMatch = [
    'whats my discord id',
    'what\'s my discord ID?',
    'what is my id',
    'whats my id',
    'whats my user id',
    'can someone send me my discord id',
    'Can anyone tell me my id?',
    'could somebody give me my discord id',
    'how do i get my id',
    'how do i find my discord id',
    'how to get my discord id',
    'how can i see my discord id',
    'where do i find my user id',
    'wheres my discord id',
    'where is my discord id',
    'i need my discord id',
    'i want to know my discord id',
    'someone send me my discord id please',
    'does anyone know what my id is',
    'please tell me my discord id',
    'how do i copy my discord id',
    'how do i know my discord id',
    'can you retrieve my discord id',
];

const shouldNotMatch = [
    'whats my idea',
    'whats my idea for the next event',
    'my discord id is 123456789',
    'whats your discord id',
    'send me your discord id',
    'can someone send me his discord id',
    'dm me your id',
    'he took my id',
    'what id do i use for the league',
    'whats my rank',
    'anyone know my discord username',
    'i lost my id card',
    'Can anyone help? My discord id is on my profile.',
];

test('matchesIdQuestion catches people asking for their own id', () => {
    for (const msg of shouldMatch) {
        assert.strictEqual(matchesIdQuestion(msg), true, `should match: "${msg}"`);
    }
});

test('matchesIdQuestion ignores everything else', () => {
    for (const msg of shouldNotMatch) {
        assert.strictEqual(matchesIdQuestion(msg), false, `should NOT match: "${msg}"`);
    }
});

const makeMessage = (overrides = {}) => {
    const replies = [];
    return {
        author: { bot: false, id: '123456789012345678' },
        channelId: '999',
        guildId: '752',
        content: 'whats my discord id',
        reply: async (payload) => { replies.push(payload); },
        replies,
        ...overrides,
    };
};

test('execute replies with the asker id and ignores bots and non-questions', async () => {
    const answered = makeMessage({ author: { bot: false, id: '111111111111111111' } });
    await listener.execute(answered);
    assert.strictEqual(answered.replies.length, 1);
    const text = JSON.stringify(answered.replies[0]);
    assert.ok(text.includes('111111111111111111'), 'reply should contain the author id');

    const ignored = [
        makeMessage({ author: { bot: true, id: '1' } }),
        makeMessage({ content: 'whats my rank' }),
    ];
    for (const message of ignored) {
        await listener.execute(message);
        assert.strictEqual(message.replies.length, 0);
    }
});

test('execute answers each person once per cooldown window', async () => {
    const author = { bot: false, id: '222222222222222222' };
    const first = makeMessage({ author });
    const second = makeMessage({ author });
    await listener.execute(first);
    await listener.execute(second);
    assert.strictEqual(first.replies.length, 1);
    assert.strictEqual(second.replies.length, 0, 'repeat asks inside the window stay quiet');

    const other = makeMessage({ author: { bot: false, id: '333333333333333333' } });
    await listener.execute(other);
    assert.strictEqual(other.replies.length, 1, 'a different person still gets an answer');
});
