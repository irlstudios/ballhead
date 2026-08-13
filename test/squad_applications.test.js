'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { applyGate, buildApplicationCardLines, MAX_PENDING_APPLICATIONS } = require('../handlers/squad_discovery');

const squad = (over) => ({ id: 1, name: 'ABC', squad_type: 'Casual', owner_id: 'o', recruiting: 'Apply', member_count: 3, ...over });

test('applyGate refuses leaders, members, capped applicants, and non-Apply squads', () => {
    assert.strictEqual(applyGate({ isLeader: true, membership: null, pendingCount: 0, squad: squad() }).code, 'LEADER');
    assert.strictEqual(applyGate({ isLeader: false, membership: { squad: { id: 9 } }, pendingCount: 0, squad: squad() }).code, 'IN_A_SQUAD');
    assert.strictEqual(applyGate({ isLeader: false, membership: null, pendingCount: MAX_PENDING_APPLICATIONS, squad: squad() }).code, 'TOO_MANY');
    assert.strictEqual(applyGate({ isLeader: false, membership: null, pendingCount: 0, squad: squad({ recruiting: 'Open' }) }).code, 'NOT_APPLY');
    assert.strictEqual(applyGate({ isLeader: false, membership: null, pendingCount: 0, squad: null }).code, 'NO_SQUAD');
    assert.strictEqual(applyGate({ isLeader: false, membership: null, pendingCount: 0, squad: squad() }).ok, true);
});

test('application card lines show applicant, squad, and message', () => {
    const lines = buildApplicationCardLines(
        { id: 7, user_id: 'u1', username: 'player', message: 'let me in' },
        squad()
    );
    const text = lines.join('\n');
    assert.match(text, /<@u1>/);
    assert.match(text, /ABC/);
    assert.match(text, /let me in/);
});
