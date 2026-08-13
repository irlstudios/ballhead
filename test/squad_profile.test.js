'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { profileGate, DESCRIPTION_MAX } = require('../commands/squads/squad_profile');

test('profile gate requires at least one field and caps description length', () => {
    assert.strictEqual(profileGate({}).code, 'NOTHING');
    assert.strictEqual(profileGate({ description: 'x'.repeat(DESCRIPTION_MAX + 1) }).code, 'TOO_LONG');
    assert.strictEqual(profileGate({ description: 'We scrim nightly' }).ok, true);
    assert.strictEqual(profileGate({ recruiting: 'Apply' }).ok, true);
});
