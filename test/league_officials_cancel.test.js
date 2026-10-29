'use strict';

const test = require('node:test');
const assert = require('node:assert');

// Mocks db.js and utils/logger.js by swapping the
// module cache entry before handlers/league-officials is first required
// (mirrors test/league_officials_assign.test.js). Covers the requester-facing
// cancel button (official:cancel:<id>): gated to the original requester and a
// still-Pending request, and a successful cancel must resolve the request the
// same way a CD denial does -- cancelPendingOfficialRequest flips it to
// Denied and the ops card is refreshed to its terminal state.

function installMock(relativePath, mockExports) {
    const modulePath = require.resolve(relativePath);
    require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports: mockExports };
}

// Mutable per-test fixture; reset() runs at the top of every test.
const state = {
    request: null,
    cancelResult: null,
    cancelCalls: [],
};

function reset({ request = null, cancelResult = null } = {}) {
    state.request = request;
    state.cancelResult = cancelResult;
    state.cancelCalls = [];
}

installMock('../db', {
    fetchOfficialRequestById: async () => state.request,
    fetchLeagueById: async (id) => ({ league_id: id, league_name: 'Sky Ballers', league_status: 'Active' }),
    cancelPendingOfficialRequest: async (id, reason, actor) => {
        state.cancelCalls.push({ id, reason, actor });
        return state.cancelResult;
    },
});

installMock('../utils/logger', {
    info: () => {},
    warn: () => {},
    error: () => {},
});

const { handleOfficialsButton } = require('../handlers/league-officials');

const payloadText = (payload) => JSON.stringify(payload);

const pendingRequest = Object.freeze({
    id: 5,
    league_id: 7,
    sport: 'Soccer',
    status: 'Pending',
    requested_by: 'requester-1',
    match_details: 'vs Rivals',
    proposed_time: null,
    ops_message_id: 'ops-msg-1',
});

function makeInteraction(userId, { opsEdits = [] } = {}) {
    const editReplies = [];
    const interaction = {
        customId: 'official:cancel:5',
        user: { id: userId },
        client: {
            channels: {
                fetch: async () => ({
                    messages: {
                        fetch: async () => ({ edit: async (payload) => { opsEdits.push(payload); } }),
                    },
                }),
            },
        },
        deferReply: async () => {},
        editReply: async (payload) => { editReplies.push(payload); },
    };
    return { interaction, editReplies, opsEdits };
}

test('a non-requester cannot cancel someone else\'s pending request', async () => {
    reset({ request: pendingRequest });
    const { interaction, editReplies } = makeInteraction('intruder-9');

    await handleOfficialsButton(interaction);

    assert.strictEqual(state.cancelCalls.length, 0, 'the request must not be touched');
    assert.strictEqual(editReplies.length, 1);
    assert.ok(payloadText(editReplies[0]).includes('Not Your Request'));
});

test('cancel is refused once the request is no longer pending', async () => {
    reset({ request: { ...pendingRequest, status: 'Assigned', assigned_official_id: 'official-9' } });
    const { interaction, editReplies } = makeInteraction('requester-1');

    await handleOfficialsButton(interaction);

    assert.strictEqual(state.cancelCalls.length, 0, 'an assigned request must not be cancelled');
    assert.strictEqual(editReplies.length, 1);
    assert.ok(payloadText(editReplies[0]).includes('No Longer Pending'));
});

test('the requester cancels a pending request: denial-marked and ops card resolved', async () => {
    reset({
        request: pendingRequest,
        cancelResult: {
            ...pendingRequest,
            status: 'Denied',
            denial_reason: 'Cancelled by requester',
            denied_by: 'requester-1',
        },
    });
    const { interaction, editReplies, opsEdits } = makeInteraction('requester-1');

    await handleOfficialsButton(interaction);

    // Marked exactly like a CD denial: same atomic claim, requester as actor.
    assert.deepStrictEqual(state.cancelCalls, [{ id: 5, reason: 'Cancelled by requester', actor: 'requester-1' }]);
    // Ops card refreshed to its terminal (button-less, Denied) state.
    assert.strictEqual(opsEdits.length, 1);
    assert.ok(payloadText(opsEdits[0]).includes('Cancelled by requester'));
    assert.strictEqual(editReplies.length, 1);
    assert.ok(payloadText(editReplies[0]).includes('cancelled'));
});

test('a lost claim race (assigned mid-click) reports already handled', async () => {
    reset({ request: pendingRequest, cancelResult: null });
    const { interaction, editReplies, opsEdits } = makeInteraction('requester-1');

    await handleOfficialsButton(interaction);

    assert.strictEqual(state.cancelCalls.length, 1, 'the atomic claim itself is attempted');
    assert.strictEqual(opsEdits.length, 0, 'a lost claim must not rewrite the ops card');
    assert.ok(payloadText(editReplies[0]).includes('Already Handled'));
});
