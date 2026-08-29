'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

// The handler destructures its db functions at require time, so the stub has to
// be installed before it is loaded. Each test file runs in its own process.
const db = require('../db');
const deleted = [];
db.deleteFfOfficialApplication = async (discordId) => { deleted.push(discordId); };

const { handleFfOfficialApplicationApprove } = require('../handlers/ff_officials');
const { FF_APPLICATION_MANAGERS, FF_OFFICIAL_ROLE_ID } = require('../config/constants');

const approveMock = ({ roleFound }) => {
    const state = { replies: [], cardEdited: false, rolesAdded: [], dmSent: false };
    const applicant = {
        roles: { add: async (role) => { state.rolesAdded.push(role.id); } },
        send: async () => { state.dmSent = true; },
    };
    return {
        state,
        interaction: {
            user: { id: FF_APPLICATION_MANAGERS[0] },
            customId: 'ffApprove_555',
            deferred: true,
            replied: false,
            deferReply: async () => {},
            editReply: async (payload) => { state.replies.push(JSON.stringify(payload)); },
            guild: {
                members: { fetch: async () => applicant },
                roles: { cache: { get: (id) => (roleFound && id === FF_OFFICIAL_ROLE_ID ? { id } : null) } },
            },
            message: { edit: async () => { state.cardEdited = true; } },
        },
    };
};

test('approving grants the role, then closes the application out', async () => {
    deleted.length = 0;
    const { state, interaction } = approveMock({ roleFound: true });

    await handleFfOfficialApplicationApprove(interaction);

    assert.deepStrictEqual(state.rolesAdded, [FF_OFFICIAL_ROLE_ID]);
    assert.deepStrictEqual(deleted, ['555']);
    assert.ok(state.cardEdited, 'the review card should be marked accepted');
    assert.ok(state.dmSent, 'the applicant should be told');
});

test('a missing FF Official role leaves the application open instead of faking success', async () => {
    deleted.length = 0;
    const { state, interaction } = approveMock({ roleFound: false });

    await handleFfOfficialApplicationApprove(interaction);

    assert.deepStrictEqual(state.rolesAdded, []);
    assert.deepStrictEqual(deleted, [], 'the application must survive a failed grant');
    assert.ok(!state.cardEdited, 'the card must not be marked accepted');
    assert.ok(!state.dmSent, 'the applicant must not be told the role was granted');
    assert.ok(state.replies.join('').includes('still open'));
});
