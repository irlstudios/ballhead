'use strict';

const test = require('node:test');
const assert = require('node:assert');

// Mocks db.js, utils/tourny_client.js and utils/logger.js by swapping the
// module cache entry before handlers/league-officials is first required
// (mirrors test/league_officials_assign.test.js). Covers the requester-facing
// cancel button (official:cancel:<id>): gated to the original requester and a
// still-Pending request, and a successful cancel must resolve the request the
// same way a CD denial does -- cancelPendingOfficialRequest flips it to
// Denied, the ops card is refreshed to its terminal state, and a linked
// request pushes clearOfficial so tourny's officialRequested flag resets.

function installMock(relativePath, mockExports) {
    const modulePath = require.resolve(relativePath);
    require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports: mockExports };
}

// Mutable per-test fixture; reset() runs at the top of every test.
const state = {
    request: null,
    cancelResult: null,
    cancelCalls: [],
    clearCalls: [],
};

function reset({ request = null, cancelResult = null } = {}) {
    state.request = request;
    state.cancelResult = cancelResult;
    state.cancelCalls = [];
    state.clearCalls = [];
}

installMock('../db', {
    fetchOfficialRequestById: async () => state.request,
    fetchLeagueById: async (id) => ({ league_id: id, league_name: 'Sky Ballers', league_status: 'Active' }),
    cancelPendingOfficialRequest: async (id, reason, actor) => {
        state.cancelCalls.push({ id, reason, actor });
        return state.cancelResult;
    },
});

installMock('../utils/tourny_client', {
    enabled: () => true,
    clearOfficial: async (guildId, gameId, seasonId) => {
        state.clearCalls.push({ guildId, gameId, seasonId });
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
    tourny_game_id: null,
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

test('the requester cancels a pending linked request: denial-marked, ops card resolved, clearOfficial pushed', async () => {
    const linked = {
        ...pendingRequest,
        tourny_guild_id: 'guild-1',
        tourny_season_id: 'season-1',
        tourny_game_id: 'game-1',
    };
    reset({
        request: linked,
        cancelResult: {
            ...linked,
            status: 'Denied',
            denial_reason: 'Cancelled by requester',
            denied_by: 'requester-1',
        },
    });
    const { interaction, editReplies, opsEdits } = makeInteraction('requester-1');

    await handleOfficialsButton(interaction);

    // Marked exactly like a CD denial: same atomic claim, requester as actor.
    assert.deepStrictEqual(state.cancelCalls, [{ id: 5, reason: 'Cancelled by requester', actor: 'requester-1' }]);
    // Linked request resets tourny's officialRequested flag, like the deny path.
    assert.deepStrictEqual(state.clearCalls, [{ guildId: 'guild-1', gameId: 'game-1', seasonId: 'season-1' }]);
    // Ops card refreshed to its terminal (button-less, Denied) state.
    assert.strictEqual(opsEdits.length, 1);
    assert.ok(payloadText(opsEdits[0]).includes('Cancelled by requester'));
    assert.strictEqual(editReplies.length, 1);
    assert.ok(payloadText(editReplies[0]).includes('cancelled'));
});

test('an unlinked cancel never calls clearOfficial', async () => {
    reset({
        request: pendingRequest,
        cancelResult: { ...pendingRequest, status: 'Denied', denial_reason: 'Cancelled by requester' },
    });
    const { interaction, editReplies } = makeInteraction('requester-1');

    await handleOfficialsButton(interaction);

    assert.strictEqual(state.cancelCalls.length, 1);
    assert.strictEqual(state.clearCalls.length, 0);
    assert.ok(payloadText(editReplies[0]).includes('cancelled'));
});

test('a lost claim race (assigned mid-click) reports already handled and pushes nothing', async () => {
    reset({ request: pendingRequest, cancelResult: null });
    const { interaction, editReplies, opsEdits } = makeInteraction('requester-1');

    await handleOfficialsButton(interaction);

    assert.strictEqual(state.cancelCalls.length, 1, 'the atomic claim itself is attempted');
    assert.strictEqual(state.clearCalls.length, 0, 'a lost claim must not clear the tourny official');
    assert.strictEqual(opsEdits.length, 0, 'a lost claim must not rewrite the ops card');
    assert.ok(payloadText(editReplies[0]).includes('Already Handled'));
});
