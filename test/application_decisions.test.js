'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { PermissionsBitField, TextDisplayBuilder, ContainerBuilder } = require('discord.js');

// The helpers call the queries through the module object, so stubbing its
// exports here is enough; this file runs in its own node:test process.
const queries = require('../utils/application_decision_queries');
const inserted = [];
const deletedIds = [];
let insertResult = 7;
queries.insertApplicationDecision = async (row) => { inserted.push(row); return insertResult; };
queries.deleteApplicationDecision = async (id) => { deletedIds.push(id); };

const {
    canReviewApplications,
    cardText,
    claimApplicationDecision,
    releaseApplicationDecision,
} = require('../utils/applications');

const reviewer = ({ manageRoles = false, roleIds = [], userId = 'u1' } = {}) => ({
    user: { id: userId },
    member: {
        permissions: { has: (flag) => manageRoles && flag === PermissionsBitField.Flags.ManageRoles },
        roles: { cache: new Map(roleIds.map((id) => [id, {}])) },
    },
});

test('Manage Roles can review any application', () => {
    assert.strictEqual(canReviewApplications(reviewer({ manageRoles: true })), true);
});

test('a listed lead user or lead role can review without Manage Roles', () => {
    assert.strictEqual(canReviewApplications(reviewer({ userId: 'lead' }), { userIds: ['lead'] }), true);
    assert.strictEqual(canReviewApplications(reviewer({ roleIds: ['leadRole'] }), { roleIds: ['leadRole'] }), true);
});

test('anyone else is refused', () => {
    assert.strictEqual(canReviewApplications(reviewer({ roleIds: ['other'] }), { userIds: ['lead'], roleIds: ['leadRole'] }), false);
    assert.strictEqual(canReviewApplications({ user: { id: 'u1' }, member: null }), false);
});

test('cardText pulls every text block out of a Components V2 card', () => {
    const container = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('**New EMH Application**'))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('**In-game name:** Ace'));
    const text = cardText({ components: [container.toJSON(), { type: 1, components: [{ type: 2, label: 'Accept' }] }] });
    assert.strictEqual(text, '**New EMH Application**\n**In-game name:** Ace');
    assert.strictEqual(cardText(undefined), '');
});

test('claiming records who decided what on which card', async () => {
    inserted.length = 0;
    insertResult = 7;
    const interaction = {
        ...reviewer({ userId: 'rev-1' }),
        message: { id: 'msg-1', components: [{ type: 10, content: 'card body' }] },
    };

    const claimId = await claimApplicationDecision(interaction, { program: 'emh', applicantId: '42', decision: 'Accepted' });

    assert.strictEqual(claimId, 7);
    assert.deepStrictEqual(inserted, [{
        program: 'emh', messageId: 'msg-1', applicantId: '42', decision: 'Accepted', decidedBy: 'rev-1', cardText: 'card body',
    }]);
});

test('a card that was already decided cannot be claimed again', async () => {
    insertResult = null;
    const interaction = { ...reviewer(), message: { id: 'msg-1', components: [] } };
    assert.strictEqual(await claimApplicationDecision(interaction, { program: 'emh', applicantId: '42', decision: 'Denied' }), null);
});

test('releasing a claim deletes it, and a missing claim is a no-op', async () => {
    deletedIds.length = 0;
    await releaseApplicationDecision(7);
    await releaseApplicationDecision(null);
    assert.deepStrictEqual(deletedIds, [7]);
});

test('a failed release is logged, not thrown, so the reviewer still gets a reply', async () => {
    queries.deleteApplicationDecision = async () => { throw new Error('db down'); };
    await assert.doesNotReject(() => releaseApplicationDecision(9));
});
