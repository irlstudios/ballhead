'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const OWNER_ID = '111111111111111111';
const DEPARTED_MEMBER_ID = '222222222222222222';

function installSheetsMock(mockExports) {
    const modulePath = require.resolve('../utils/sheets_cache');
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

test('/remove-from-squad removes a stored member who is no longer in the guild', async () => {
    const clearedRanges = [];
    const updates = [];
    const replies = [];
    const followUps = [];
    const sheetValues = {
        'All Data!A:H': [
            ['Username', 'Discord ID', 'Squad', 'Type', 'Event', 'Active', 'Leader', 'Preference'],
            ['Owner', OWNER_ID, 'ALPHA', 'Casual', 'N/A', 'TRUE', 'Yes', 'TRUE'],
            ['Departed Player', DEPARTED_MEMBER_ID, 'ALPHA', 'Casual', 'N/A', 'TRUE', 'No', 'FALSE'],
        ],
        'Squad Leaders!A:G': [
            ['Username', 'Discord ID', 'Squad', 'Event Squad', 'Unknown', 'Created', 'Parent'],
            ['Owner', OWNER_ID, 'ALPHA', 'N/A', 'FALSE', '07/25/26', ''],
            ['Owner', OWNER_ID, 'BETA', 'N/A', 'FALSE', '07/25/26', ''],
        ],
        'Squad Members!A:E': [
            ['Username', 'Discord ID', 'Squad', 'Joined', 'Unknown'],
            ['Departed Player', DEPARTED_MEMBER_ID, 'ALPHA', '07/01/26', ''],
        ],
    };
    const sheets = {
        spreadsheets: {
            values: {
                get: async ({ range }) => ({ data: { values: sheetValues[range] || [] } }),
                clear: async ({ range }) => {
                    clearedRanges.push(range);
                },
                update: async (request) => {
                    updates.push(request);
                },
            },
        },
    };

    installSheetsMock({
        getSheetsClient: async () => sheets,
        getCachedValues: async () => new Map(),
        invalidateRanges: () => {},
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

    assert.deepEqual(clearedRanges, ['Squad Members!A2:E2']);
    assert.deepEqual(updates.map(update => update.range), ['All Data!C3:G3']);
    assert.deepEqual(updates[0].resource.values, [['N/A', 'N/A', 'N/A', 'FALSE', 'No']]);
    assert.equal(followUps.length, 0);
    assert.match(payloadText(replies.at(-1)), /no longer in the server/i);
    assert.match(payloadText(replies.at(-1)), /successfully removed/i);
});
