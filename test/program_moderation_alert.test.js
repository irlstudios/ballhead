'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
    matchProgramRoles,
    buildAlertText,
} = require('../utils/program_moderation_alert');

const PROGRAM_ROLE_IDS = ['111', '222', '333'];

// --- matchProgramRoles -------------------------------------------------------

test('returns the program roles the member holds, in program order', () => {
    const matched = matchProgramRoles(['999', '333', '111'], PROGRAM_ROLE_IDS);
    assert.deepStrictEqual(matched, ['111', '333']);
});

test('returns an empty array when the member holds no program roles', () => {
    const matched = matchProgramRoles(['999', '888'], PROGRAM_ROLE_IDS);
    assert.deepStrictEqual(matched, []);
});

test('tolerates a null or undefined member role list', () => {
    assert.deepStrictEqual(matchProgramRoles(null, PROGRAM_ROLE_IDS), []);
    assert.deepStrictEqual(matchProgramRoles(undefined, PROGRAM_ROLE_IDS), []);
});

// --- buildAlertText ----------------------------------------------------------

test('builds an alert mentioning the action, user, moderator, reason and log link', () => {
    const text = buildAlertText({
        action: 'Mute',
        userId: '1330740662181564427',
        targetName: 'bob1102976',
        moderator: '@Superman',
        length: '2 hours',
        reason: 'spamming',
        matchedRoleLabels: ['Official'],
        messageUrl: 'https://discord.com/channels/1/2/3',
        rolesHistorical: false,
    });
    assert.match(text, /Mute/);
    assert.match(text, /<@1330740662181564427>/);
    assert.match(text, /@Superman/);
    assert.match(text, /2 hours/);
    assert.match(text, /spamming/);
    assert.match(text, /Official/);
    assert.match(text, /https:\/\/discord\.com\/channels\/1\/2\/3/);
});

test('omits the length line when no length is provided', () => {
    const text = buildAlertText({
        action: 'Warn',
        userId: '1',
        targetName: 'movinoctane',
        moderator: '@Mod',
        length: null,
        reason: 'spamming',
        matchedRoleLabels: ['Official'],
        messageUrl: 'https://discord.com/channels/1/2/3',
        rolesHistorical: false,
    });
    assert.doesNotMatch(text, /Length/i);
});

test('falls back to the target name when no user id is known', () => {
    const text = buildAlertText({
        action: 'Ban',
        userId: null,
        targetName: 'jitwilding',
        moderator: '@Mod',
        length: null,
        reason: 'cheating',
        matchedRoleLabels: ['Official'],
        messageUrl: 'https://discord.com/channels/1/2/3',
        rolesHistorical: true,
    });
    assert.match(text, /jitwilding/);
    assert.doesNotMatch(text, /<@null>/);
});

test('notes when matched roles are historical (member already left)', () => {
    const text = buildAlertText({
        action: 'Ban',
        userId: '1',
        targetName: 'jitwilding',
        moderator: '@Mod',
        length: null,
        reason: 'cheating',
        matchedRoleLabels: ['Official'],
        messageUrl: 'https://discord.com/channels/1/2/3',
        rolesHistorical: true,
    });
    assert.match(text, /previously|historical|had/i);
});

test('uses a fallback reason label when none provided', () => {
    const text = buildAlertText({
        action: 'Ban',
        userId: '1',
        targetName: 'jitwilding',
        moderator: '@Mod',
        length: null,
        reason: null,
        matchedRoleLabels: ['Official'],
        messageUrl: 'https://discord.com/channels/1/2/3',
        rolesHistorical: false,
    });
    assert.match(text, /No reason provided/i);
});
