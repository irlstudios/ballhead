'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const axios = require('axios');

const db = require('../db');
const constants = require('../config/constants');

// Handlers capture db functions at require time, so the stubs must be in place
// before the handler loads. This file runs in its own node:test process.
db.findLeagueCreationBlock = async () => null;

const { handleApplyBaseLeagueModal } = require('../handlers/leagues');

// Discord answers 404 for an invite that was revoked, expired or mistyped.
const unknownInvite = () => {
    const config = { headers: { Authorization: 'Bot secret-token' } };
    const request = { method: 'GET' };
    const response = { status: 404, data: { message: 'Unknown Invite', code: 10006 }, request, config };
    request.res = response;
    return new axios.AxiosError('Request failed with status code 404', 'ERR_BAD_REQUEST', config, request, response);
};

const applicantInteraction = (invite) => {
    const state = { editReplied: null };
    return {
        state,
        interaction: {
            user: { id: '42', username: 'applicant' },
            member: { roles: { cache: { has: (id) => id === constants.LEVEL_5_ROLE_ID } } },
            fields: { getTextInputValue: (id) => (id === 'league-name' ? 'Test League' : invite) },
            deferReply: async () => {},
            editReply: async (payload) => { state.editReplied = payload; },
            replied: false,
            deferred: true,
        },
    };
};

test('a dead invite link gets the invalid-invite notice, not a failed interaction', async (t) => {
    t.mock.method(axios, 'get', async () => { throw unknownInvite(); });
    const { state, interaction } = applicantInteraction('https://discord.gg/deadcode');

    await handleApplyBaseLeagueModal(interaction);

    const reply = JSON.stringify(state.editReplied);
    assert.ok(reply.includes('Invite Invalid'), `expected the invalid-invite notice, got: ${reply}`);
    assert.ok(!reply.includes('An error occurred'), `a dead link is user input, not an error: ${reply}`);
});

test('other invite lookup failures still reach the generic error reply', async (t) => {
    t.mock.method(axios, 'get', async () => { throw new Error('socket hang up'); });
    const { state, interaction } = applicantInteraction('https://discord.gg/realcode');

    await handleApplyBaseLeagueModal(interaction);

    const reply = JSON.stringify(state.editReplied);
    assert.ok(reply.includes('An error occurred'), `expected the generic failure, got: ${reply}`);
});
