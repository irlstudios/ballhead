'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const OWNER_ID = '111111111111111111';
const DEPARTED_MEMBER_ID = '222222222222222222';

function installMock(relativePath, mockExports) {
    const modulePath = require.resolve(relativePath);
    require.cache[modulePath] = {
        id: modulePath,
        filename: modulePath,
        loaded: true,
        exports: mockExports,
    };
}

function unknownMemberError() {
    return Object.assign(new Error('Unknown Member'), { code: 10007 });
}

function payloadText(payload) {
    return JSON.stringify(payload);
}

test('/squad remove-member removes a stored member who is no longer in the guild', async () => {
    const removals = [];
    const replies = [];
    const followUps = [];

    const alpha = { id: 1, name: 'ALPHA', squad_type: 'Casual', owner_id: OWNER_ID, event_squad: null };
    const beta = { id: 2, name: 'BETA', squad_type: 'Casual', owner_id: OWNER_ID, event_squad: null };

    installMock('../utils/squad_db', {
        normalizeSquadName: (raw) => String(raw ?? '').trim().toUpperCase(),
        disambiguateOwnedSquad: () => ({ squad: alpha, error: null }),
        fetchSquadsByOwner: async () => [alpha, beta],
        fetchMembership: async (userId) => (userId === DEPARTED_MEMBER_ID
            ? { squad: alpha, member: { user_id: DEPARTED_MEMBER_ID, username: 'Departed Player', joined_at: null } }
            : null),
        fetchSquadMembers: async () => [{ squad_id: 1, user_id: DEPARTED_MEMBER_ID, username: 'Departed Player' }],
        removeSquadMember: async (squadId, userId) => {
            removals.push([squadId, userId]);
            return { squad_id: squadId, user_id: userId };
        },
    });

    const commandPath = require.resolve('../commands/squads/squad_remove_member');
    delete require.cache[commandPath];
    const command = require(commandPath);

    const guild = {
        members: {
            fetch: async () => {
                throw unknownMemberError();
            },
        },
    };
    const interaction = {
        user: { id: OWNER_ID, tag: 'Owner#0001' },
        guild,
        options: {
            getString: name => name === 'member' ? DEPARTED_MEMBER_ID : null,
        },
        client: {
            guilds: {
                fetch: async () => ({
                    channels: {
                        fetch: async () => ({ send: async () => {} }),
                    },
                }),
            },
        },
        deferReply: async () => {},
        editReply: async payload => {
            replies.push(payload);
        },
        followUp: async payload => {
            followUps.push(payload);
        },
    };

    const memberOption = command.data.toJSON().options.find(option => option.name === 'member');
    assert.equal(memberOption.type, 3);
    assert.equal(memberOption.autocomplete, true);

    await command.execute(interaction);

    assert.deepEqual(removals, [[1, DEPARTED_MEMBER_ID]]);
    assert.equal(followUps.length, 0);
    assert.match(payloadText(replies.at(-1)), /no longer in the server/i);
    assert.match(payloadText(replies.at(-1)), /successfully removed/i);
});
