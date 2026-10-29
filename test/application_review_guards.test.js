'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { PermissionsBitField } = require('discord.js');

// Every Accept/Deny card must: refuse reviewers who are not allowed, act on
// a card only once however many times it is clicked, record who decided what,
// and free the card again when a decision fails partway. Handlers capture
// their db and sheets functions at require time, so the stubs go in first;
// this file runs in its own node:test process.
const db = require('../db');
const sheetsCache = require('../utils/sheets_cache');
const queries = require('../utils/application_decision_queries');
const constants = require('../config/constants');

const CARD_URL = 'https://discord.com/channels/1/2/card-1';
const state = { deleted: [], claims: [], released: [], claimResult: 1 };

for (const name of [
    'deleteEmhApplication', 'deleteCdtApplication', 'deleteBugSquasherApplication',
    'deleteFfOfficialApplication', 'deleteTbProCcApplication', 'deleteOfficialApplication',
]) {
    db[name] = async (id) => { state.deleted.push(id); };
}
sheetsCache.getSheetsClient = async () => ({
    spreadsheets: {
        values: {
            get: async () => ({ data: { values: [['a', 'b', 'c', CARD_URL]] } }),
            update: async () => {},
        },
    },
});
queries.insertApplicationDecision = async (row) => { state.claims.push(row); return state.claimResult; };
queries.deleteApplicationDecision = async (id) => { state.released.push(id); };

const CASES = [
    {
        program: 'emh', module: '../handlers/emh_applications', ids: ['emhApprove_42', 'emhReject_42'],
        handlers: ['handleEmhApplicationApprove', 'handleEmhApplicationReject'],
        lead: { userId: constants.EMH_LEAD_IDS[0] },
    },
    {
        program: 'cdt', module: '../handlers/cdt_applications', ids: ['cdtApprove_42', 'cdtReject_42'],
        handlers: ['handleCdtApplicationApprove', 'handleCdtApplicationReject'],
        lead: { roleIds: [constants.CDT_LEAD_ROLE_ID] },
    },
    {
        program: 'bug_squasher', module: '../handlers/bug_squasher', ids: ['cbsApprove_42', 'cbsReject_42'],
        handlers: ['handleBugSquasherApplicationApprove', 'handleBugSquasherApplicationReject'],
    },
    {
        // FF reviews are limited to its named managers, Manage Roles or not.
        program: 'ff_official', module: '../handlers/ff_officials', ids: ['ffApprove_42', 'ffReject_42'],
        handlers: ['handleFfOfficialApplicationApprove', 'handleFfOfficialApplicationReject'],
        reviewer: { userId: constants.FF_APPLICATION_MANAGERS[0], manageRoles: false },
    },
    {
        program: 'tb_pro_cc', module: '../handlers/tb_pro_cc_applications', ids: ['tbpccApprove_42', 'tbpccReject_42'],
        handlers: ['handleTbProCcApplicationApprove', 'handleTbProCcApplicationReject'],
    },
    {
        program: 'officials', module: '../handlers/officials', ids: ['approve_42', 'reject_42'],
        handlers: ['handleOfficialsApplicationApprove', 'handleOfficialsApplicationReject'],
    },
];

// Approve and reject for every program, as one flat list.
const DECISIONS = CASES.flatMap((c) => [0, 1].map((i) => ({
    ...c,
    customId: c.ids[i],
    handlerName: c.handlers[i],
    handler: require(c.module)[c.handlers[i]],
    decision: i === 0 ? 'Accepted' : 'Denied',
})));

function reset(claimResult = 1) {
    state.deleted = [];
    state.claims = [];
    state.released = [];
    state.claimResult = claimResult;
}

function fakeInteraction(customId, { userId = 'reviewer', manageRoles = true, roleIds = [], failCardEdit = false, failRoleAdd = false, failReplyAfterClose = false } = {}) {
    const seen = { replies: [], rolesAdded: [], dms: 0, cardEdits: 0 };
    const applicant = {
        id: '42',
        user: { id: '42', tag: 'applicant#0001' },
        roles: {
            add: async (role) => {
                if (failRoleAdd) throw new Error('missing permissions');
                seen.rolesAdded.push(role && role.id);
            },
            remove: async () => {},
            cache: new Map(),
        },
        send: async () => { seen.dms += 1; },
    };
    const interaction = {
        customId,
        user: { id: userId },
        member: {
            permissions: { has: (flag) => manageRoles && flag === PermissionsBitField.Flags.ManageRoles },
            roles: { cache: new Map(roleIds.map((id) => [id, {}])) },
        },
        guild: {
            members: { fetch: async () => applicant },
            roles: { cache: { get: (id) => ({ id }) } },
        },
        replied: false,
        deferReply: async () => {},
        editReply: async (payload) => {
            if (failReplyAfterClose && seen.cardEdits > 0) throw new Error('interaction token expired');
            seen.replies.push(JSON.stringify(payload));
        },
        message: {
            id: 'card-1',
            url: CARD_URL,
            components: [{ type: 10, content: 'card body' }],
            edit: async () => {
                if (failCardEdit) throw new Error('card edit failed');
                seen.cardEdits += 1;
            },
        },
    };
    return { seen, interaction };
}

const allowed = (c) => c.reviewer || {};

for (const d of DECISIONS) {
    test(`${d.handlerName}: a member who may not review is refused and nothing changes`, async () => {
        reset();
        const { seen, interaction } = fakeInteraction(d.customId, { userId: 'stranger', manageRoles: false });

        await d.handler(interaction);

        assert.match(seen.replies.join(), /permission/i);
        assert.deepStrictEqual(state.claims, []);
        assert.deepStrictEqual(seen.rolesAdded, []);
        assert.strictEqual(seen.dms, 0);
        assert.deepStrictEqual(state.deleted, []);
        assert.strictEqual(seen.cardEdits, 0);
    });

    test(`${d.handlerName}: a second click on an already decided card does nothing`, async () => {
        reset(null);
        const { seen, interaction } = fakeInteraction(d.customId, allowed(d));

        await d.handler(interaction);

        assert.match(seen.replies.join(), /already been reviewed/i);
        assert.deepStrictEqual(seen.rolesAdded, []);
        assert.strictEqual(seen.dms, 0);
        assert.deepStrictEqual(state.deleted, []);
        assert.strictEqual(seen.cardEdits, 0);
    });

    test(`${d.handlerName}: the decision is recorded with the reviewer and the card text`, async () => {
        reset();
        const { seen, interaction } = fakeInteraction(d.customId, allowed(d));

        await d.handler(interaction);

        assert.deepStrictEqual(state.claims, [{
            program: d.program,
            messageId: 'card-1',
            applicantId: '42',
            decision: d.decision,
            decidedBy: interaction.user.id,
            cardText: 'card body',
        }]);
        assert.deepStrictEqual(state.deleted, ['42']);
        assert.strictEqual(seen.cardEdits, 1);
        assert.deepStrictEqual(state.released, []);
    });

    test(`${d.handlerName}: a decision that fails partway frees the card for a retry`, async () => {
        reset(5);
        const { seen, interaction } = fakeInteraction(d.customId, { ...allowed(d), failCardEdit: true });

        await d.handler(interaction);

        assert.deepStrictEqual(state.released, [5]);
        assert.match(seen.replies.join(), /error|try again/i);
    });
    test(`${d.handlerName}: once the card is closed, a failed reply keeps the decision record`, async () => {
        reset(5);
        const { seen, interaction } = fakeInteraction(d.customId, { ...allowed(d), failReplyAfterClose: true });

        // The handler's own error reply hits the same dead token and may
        // rethrow; interactionHandler catches that, so only the record matters.
        await d.handler(interaction).catch(() => {});

        assert.strictEqual(seen.cardEdits, 1);
        assert.deepStrictEqual(state.released, [], 'the decision happened, so its record must stay');
    });

    if (d.decision === 'Accepted') {
        test(`${d.handlerName}: a failed role grant leaves the card open for a retry`, async () => {
            reset(5);
            const { seen, interaction } = fakeInteraction(d.customId, { ...allowed(d), failRoleAdd: true });

            await d.handler(interaction);

            assert.strictEqual(seen.cardEdits, 0, 'the card must not be closed as accepted');
            assert.deepStrictEqual(state.deleted, [], 'the application must survive a failed grant');
            assert.deepStrictEqual(state.released, [5]);
        });
    }
}

test('EMH leads and CDT leads can review without Manage Roles', async () => {
    for (const c of CASES.filter((x) => x.lead)) {
        reset();
        const handler = require(c.module)[c.handlers[0]];
        const { interaction } = fakeInteraction(c.ids[0], { ...c.lead, manageRoles: false });

        await handler(interaction);

        assert.strictEqual(state.claims.length, 1, `${c.program} lead should be able to accept`);
    }
});
