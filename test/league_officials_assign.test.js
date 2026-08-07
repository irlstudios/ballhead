'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { GYM_CLASS_GUILD_ID, GC_CD_ROLE_ID } = require('../config/constants');

// Mocks db.js, utils/tourny_client.js and utils/logger.js by swapping the
// module cache entry before handlers/league-officials is first required
// (mirrors test/squad_member_removal.test.js). Covers FIX 8: the assign flow
// must DM both the assigned official and the requester, not just the
// official -- /league request-official promises "You will be DMed when it is
// assigned".

function installMock(relativePath, mockExports) {
    const modulePath = require.resolve(relativePath);
    require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports: mockExports };
}

installMock('../db', {
    fetchOfficialRequestById: async (id) => ({ id, league_id: 7, sport: 'Soccer', status: 'Pending', tourny_game_id: null }),
    fetchLeagueById: async (id) => ({ league_id: id, league_name: 'Sky Ballers', league_status: 'Active' }),
    fetchAvailableOfficials: async () => [{ discord_id: 'official-9', discord_name: 'Ref Nine', sport: 'Soccer' }],
    assignOfficialRequest: async (id, officialId, assignedBy) => ({
        id,
        league_id: 7,
        sport: 'Soccer',
        status: 'Assigned',
        assigned_official_id: officialId,
        assigned_by: assignedBy,
        requested_by: 'requester-1',
        tourny_game_id: null,
        match_details: 'vs Rivals',
        proposed_time: null,
        // ops_message_id intentionally omitted: updateOpsCard no-ops without one.
    }),
});

installMock('../utils/tourny_client', {
    enabled: () => false,
    assignOfficial: async () => {},
});

installMock('../utils/logger', {
    info: () => {},
    warn: () => {},
    error: () => {},
});

const { handleOfficialsSelect } = require('../handlers/league-officials');

const payloadText = (payload) => JSON.stringify(payload);

test('assigning an official DMs both the official and the requester', async () => {
    const dms = [];
    const fakeClient = {
        users: {
            fetch: async (id) => ({
                id,
                send: async (payload) => { dms.push({ id, payload }); },
            }),
        },
    };
    const editReplies = [];
    const interaction = {
        customId: 'official:assignselect:5',
        values: ['official-9'],
        guildId: GYM_CLASS_GUILD_ID,
        member: { roles: { cache: new Set([GC_CD_ROLE_ID]) } },
        user: { id: 'staff-1' },
        client: fakeClient,
        deferReply: async () => {},
        editReply: async (payload) => { editReplies.push(payload); },
    };

    await handleOfficialsSelect(interaction);

    assert.strictEqual(dms.length, 2, 'expected one DM to the official and one to the requester');

    const officialDm = dms.find((d) => d.id === 'official-9');
    assert.ok(officialDm, 'the assigned official must be DMed');
    assert.ok(payloadText(officialDm.payload).includes('assigned to officiate'));

    const requesterDm = dms.find((d) => d.id === 'requester-1');
    assert.ok(requesterDm, 'the requester must be DMed (pre-existing /league request-official promise)');
    assert.ok(payloadText(requesterDm.payload).includes('has been assigned to'));
    assert.ok(payloadText(requesterDm.payload).includes('official-9'));
    assert.ok(payloadText(requesterDm.payload).includes('request #5'));

    assert.strictEqual(editReplies.length, 1);
});
