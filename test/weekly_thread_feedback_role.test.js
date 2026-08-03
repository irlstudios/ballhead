'use strict';

const test = require('node:test');
const assert = require('node:assert');

const listener = require('../events/weekly_thread_feedback_role');
const { WEEKLY_DISCUSSION_CHANNEL_ID, WEEKLY_FEEDBACK_ROLE_IDS } = require('../config/constants');

const makeMessage = ({ bot = false, isThread = true, parentId = WEEKLY_DISCUSSION_CHANNEL_ID, threadName = 'Weekly Discussion: Test', heldRoles = [] } = {}) => {
    const added = [];
    return {
        added,
        author: { id: 'user1', bot },
        channel: {
            isThread: () => isThread,
            parentId,
            name: threadName,
        },
        member: {
            roles: {
                cache: new Map(heldRoles.map((id) => [id, true])),
                add: async (ids) => { added.push(...ids); },
            },
        },
    };
};

test('grants both feedback roles on a weekly thread message', async () => {
    const message = makeMessage();
    await listener.execute(message);
    assert.deepStrictEqual(message.added, WEEKLY_FEEDBACK_ROLE_IDS);
});

test('only grants roles the member is missing', async () => {
    const message = makeMessage({ heldRoles: [WEEKLY_FEEDBACK_ROLE_IDS[0]] });
    await listener.execute(message);
    assert.deepStrictEqual(message.added, [WEEKLY_FEEDBACK_ROLE_IDS[1]]);
});

test('ignores bots, non-threads, other channels, and other thread names', async () => {
    const cases = [
        makeMessage({ bot: true }),
        makeMessage({ isThread: false }),
        makeMessage({ parentId: 'other-channel' }),
        makeMessage({ threadName: 'Random thread' }),
    ];
    for (const message of cases) {
        await listener.execute(message);
        assert.deepStrictEqual(message.added, []);
    }
});
