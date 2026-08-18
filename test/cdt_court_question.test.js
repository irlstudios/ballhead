'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const listener = require('../events/cdt_court_question_listener');
const { matchesCourtQuestion } = listener;
const { CDT_DESIGNS_FORUM_CHANNEL_ID } = require('../config/constants');

const shouldMatch = [
    'can anyone make me a court',
    'Can someone make a court for me?',
    'could somebody build me a custom court',
    'does anyone have a custom court',
    'anyone got a custom court?',
    'anyone have custom courts',
    'where can i get a custom court',
    'where do i find custom courts',
    'how do i get a custom court',
    'who makes custom courts',
    'can anyone design a backboard for me',
    'does anyone have custom backboards',
    'is there anyone who can make me a court',
    'any1 got a custom court',
    'Has anyone made a custom court?',
    'Can someone share a custom court?',
    'Anyone have a court they can send me?',
    'Where can I get a court?',
    'Who\'s able to make me a court?',
];

const shouldNotMatch = [
    'i love this court',
    'the court was laggy today',
    'nice court bro',
    'i made a court yesterday',
    'basketball court is my favorite map',
    'can anyone help me with my mic',
    'does anyone have a spare controller',
    'custom courts are cool',
    'i want to play on the new court',
    'supreme court ruling was wild',
    'Can anyone help? I can make a court later.',
    'Anyone can make it to court by 8.',
    'Someone is making their way to court now.',
    'Who makes the court decisions here?',
    'Does anyone know who makes Supreme Court decisions?',
];

test('matchesCourtQuestion catches court request phrasings', () => {
    for (const msg of shouldMatch) {
        assert.strictEqual(matchesCourtQuestion(msg), true, `should match: "${msg}"`);
    }
});

test('matchesCourtQuestion ignores ordinary court talk', () => {
    for (const msg of shouldNotMatch) {
        assert.strictEqual(matchesCourtQuestion(msg), false, `should NOT match: "${msg}"`);
    }
});

const makeMessage = (overrides = {}) => {
    const replies = [];
    return {
        author: { bot: false, id: '123' },
        channelId: '999',
        guildId: '752',
        content: 'can anyone make me a court',
        channel: { isDMBased: () => false, parentId: null },
        reply: async (payload) => { replies.push(payload); },
        replies,
        ...overrides,
    };
};

test('execute ignores bots, DMs, and the designs forum', async () => {
    const cases = [
        makeMessage({ author: { bot: true, id: '1' } }),
        makeMessage({ channel: { isDMBased: () => true, parentId: null } }),
        makeMessage({ channelId: CDT_DESIGNS_FORUM_CHANNEL_ID }),
        makeMessage({ channel: { isDMBased: () => false, parentId: CDT_DESIGNS_FORUM_CHANNEL_ID } }),
        makeMessage({ content: 'the court was laggy today' }),
    ];
    for (const message of cases) {
        await listener.execute(message);
        assert.strictEqual(message.replies.length, 0);
    }
});
