'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { buildCommandName } = require('../API/command-data');

const fakeInteraction = (name, group, sub) => ({
    commandName: name,
    options: {
        getSubcommandGroup: () => group ?? null,
        getSubcommand: () => sub ?? null,
    },
});

test('buildCommandName joins command, group, and subcommand', () => {
    assert.strictEqual(buildCommandName(fakeInteraction('ping')), 'ping');
    assert.strictEqual(buildCommandName(fakeInteraction('squad', null, 'invite')), 'squad invite');
    assert.strictEqual(buildCommandName(fakeInteraction('league', 'team', 'add')), 'league team add');
});

test('buildCommandName tolerates a missing options object', () => {
    assert.strictEqual(buildCommandName({ commandName: 'ping' }), 'ping');
});
