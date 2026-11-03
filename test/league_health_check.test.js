'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { nextDeadInviteChecks, INVITE_OUTCOME } = require('../jobs/league-health-check');

test('nextDeadInviteChecks counts consecutive dead invites', () => {
    assert.strictEqual(nextDeadInviteChecks(0, INVITE_OUTCOME.DEAD), 1);
    assert.strictEqual(nextDeadInviteChecks(1, INVITE_OUTCOME.DEAD), 2);
    assert.strictEqual(nextDeadInviteChecks(null, INVITE_OUTCOME.DEAD), 1);
});

test('nextDeadInviteChecks resets on a valid invite', () => {
    assert.strictEqual(nextDeadInviteChecks(4, INVITE_OUTCOME.VALID), 0);
});

test('nextDeadInviteChecks keeps the count when the check was inconclusive', () => {
    assert.strictEqual(nextDeadInviteChecks(3, INVITE_OUTCOME.UNKNOWN), 3);
    assert.strictEqual(nextDeadInviteChecks(undefined, INVITE_OUTCOME.UNKNOWN), 0);
});
