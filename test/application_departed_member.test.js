'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const db = require('../db');
const constants = require('../config/constants');
const { fetchApplicant } = require('../utils/applications');

// Handlers capture db functions at require time, so the stub must be in
// place before any handler module loads. This test file runs in its own
// node:test process, so the stub never leaks into other test files.
const deletedEmhApplications = [];
db.deleteEmhApplication = async (id) => { deletedEmhApplications.push(id); };

const deniedLeagueApplications = [];
db.findLeagueApplication = async () => [{ applicant_id: '42', league_name: 'Test League' }];
db.updateLeagueApplicationDenial = async (messageId) => { deniedLeagueApplications.push(messageId); return true; };

const unknownMemberError = () => Object.assign(new Error('Unknown Member'), { code: 10007 });

test('fetchApplicant returns the member when the fetch succeeds', async () => {
    const member = { id: '1' };
    const guild = { members: { fetch: async () => member } };
    assert.strictEqual(await fetchApplicant(guild, '1'), member);
});

test('fetchApplicant returns null when the member left the guild', async () => {
    for (const code of [10007, 10013]) {
        const guild = {
            members: {
                fetch: async () => { throw Object.assign(new Error('gone'), { code }); },
            },
        };
        assert.strictEqual(await fetchApplicant(guild, '1'), null, `code ${code} should map to null`);
    }
});

test('fetchApplicant rethrows non-departure errors', async () => {
    const guild = {
        members: {
            fetch: async () => { throw Object.assign(new Error('boom'), { code: 500 }); },
        },
    };
    await assert.rejects(() => fetchApplicant(guild, '1'), /boom/);
});

const departedInteraction = (customId, reviewerId) => {
    const state = { editReplied: null, messageEdited: false };
    return {
        state,
        interaction: {
            customId,
            user: { id: reviewerId },
            member: { permissions: { has: () => true } },
            guild: {
                members: { fetch: async () => { throw unknownMemberError(); } },
                roles: { cache: new Map() },
            },
            deferReply: async () => {},
            editReply: async (payload) => { state.editReplied = payload; },
            message: {
                url: 'https://discord.com/channels/1/2/3',
                edit: async () => { state.messageEdited = true; },
            },
            replied: false,
        },
    };
};

test('every approve handler tells the reviewer when the applicant left instead of erroring', async () => {
    const cases = [
        ['../handlers/emh_applications', 'handleEmhApplicationApprove', 'emhApprove_42', 'reviewer'],
        ['../handlers/cdt_applications', 'handleCdtApplicationApprove', 'cdtApprove_42', 'reviewer'],
        ['../handlers/officials', 'handleOfficialsApplicationApprove', 'officialsApprove_42', 'reviewer'],
        ['../handlers/ff_officials', 'handleFfOfficialApplicationApprove', 'ffOfficialApprove_42', constants.FF_APPLICATION_MANAGERS[0]],
        ['../handlers/bug_squasher', 'handleBugSquasherApplicationApprove', 'bugSquasherApprove_42', 'reviewer'],
    ];

    for (const [modulePath, handlerName, customId, reviewerId] of cases) {
        const handler = require(modulePath)[handlerName];
        assert.ok(handler, `${modulePath} missing ${handlerName}`);

        const { state, interaction } = departedInteraction(customId, reviewerId);
        await handler(interaction);

        const reply = JSON.stringify(state.editReplied);
        assert.ok(reply.includes('left the server'), `${handlerName} reply must say the applicant left, got: ${reply}`);
        assert.ok(!state.messageEdited, `${handlerName} must leave the card for Deny to close`);
    }
});

test('EMH reject completes cleanly when the applicant already left', async () => {
    const { handleEmhApplicationReject } = require('../handlers/emh_applications');
    const { state, interaction } = departedInteraction('emhReject_42', 'reviewer');

    await handleEmhApplicationReject(interaction);

    assert.deepStrictEqual(deletedEmhApplications, ['42'], 'application row must still be removed');
    assert.ok(state.messageEdited, 'card must be closed as denied');
    const reply = JSON.stringify(state.editReplied);
    assert.ok(reply.includes('denied'), `reply should confirm the denial, got: ${reply}`);
    assert.ok(!reply.includes('error'), `reply must not be the generic failure, got: ${reply}`);
});

test('league deny completes cleanly when the applicant already left', async () => {
    const { handleDenyLeagueModal } = require('../handlers/leagues');
    const { state, interaction } = departedInteraction('denyLeagueModal:msg-1', 'reviewer');
    const cardEdits = [];
    interaction.fields = { getTextInputValue: () => 'inactive league' };
    interaction.channel = {
        messages: { fetch: async () => ({ edit: async () => { cardEdits.push('edited'); } }) },
    };

    await handleDenyLeagueModal(interaction);

    assert.deepStrictEqual(deniedLeagueApplications, ['msg-1'], 'denial must still be recorded');
    assert.deepStrictEqual(cardEdits, ['edited'], 'application card must be closed as denied');
    const reply = JSON.stringify(state.editReplied);
    assert.ok(reply.includes('denied'), `reply should confirm the denial, got: ${reply}`);
    assert.ok(!reply.includes('Could not fetch'), `deny must not abort on a departed applicant, got: ${reply}`);
});
