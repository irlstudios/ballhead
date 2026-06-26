'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { buildHypeCopy, buildReengagementMessage } = require('../programs/reengagement/message_builder');

const member = {
    inGameName: 'REVROY',
    lastActiveSeason: 41,
    lapsedSeasons: 2,
    achievements: { points: '88', wins: '8', mmr: '5707' },
};

test('hype copy includes the player name, their stats and the lapse season', () => {
    const copy = buildHypeCopy({ member, changelog: ['S42: new MMR system'] });
    assert.ok(copy.headline.includes('REVROY'));
    assert.ok(copy.standing.includes('88'));
    assert.ok(copy.standing.includes('8 wins'));
    assert.ok(copy.standing.includes('5707'));
    assert.ok(copy.standing.includes('Season 41'));
    assert.ok(copy.sinceYouLeft.includes('S42: new MMR system'));
});

test('hype copy falls back gracefully when no changelog is supplied', () => {
    const copy = buildHypeCopy({ member, changelog: [] });
    assert.ok(copy.sinceYouLeft.toLowerCase().includes('not slowed down'));
});

test('message payload is Components V2 with jump and decline buttons', () => {
    const payload = buildReengagementMessage({ member, changelog: [], program: 'ff' });
    assert.ok(payload.flags, 'flags should be set for Components V2');
    assert.strictEqual(payload.components.length, 2);

    const json = JSON.stringify(payload.components.map((c) => c.toJSON()));
    assert.ok(json.includes('reengage:jump:ff'));
    assert.ok(json.includes('reengage:decline:ff'));
});
