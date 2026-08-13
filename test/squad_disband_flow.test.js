'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { ownerRolesAfterDisband } = require('../commands/squads/squad_disband');
const { SQUAD_LEADER_ROLE_ID, COMPETITIVE_SQUAD_OWNER_ROLE_ID } = require('../config/constants');

test('owner keeps roles while other squads remain, loses them when none do', () => {
    assert.deepStrictEqual(
        ownerRolesAfterDisband({ remainingSquads: [], disbandedTypes: ['Competitive'] }),
        [SQUAD_LEADER_ROLE_ID, COMPETITIVE_SQUAD_OWNER_ROLE_ID]
    );
    assert.deepStrictEqual(
        ownerRolesAfterDisband({ remainingSquads: [{ squad_type: 'Casual' }], disbandedTypes: ['Competitive'] }),
        [COMPETITIVE_SQUAD_OWNER_ROLE_ID]
    );
    assert.deepStrictEqual(
        ownerRolesAfterDisband({ remainingSquads: [{ squad_type: 'Competitive' }], disbandedTypes: ['Casual'] }),
        []
    );
    assert.deepStrictEqual(
        ownerRolesAfterDisband({ remainingSquads: [], disbandedTypes: ['Casual', 'Competitive'] }),
        [SQUAD_LEADER_ROLE_ID, COMPETITIVE_SQUAD_OWNER_ROLE_ID]
    );
});
