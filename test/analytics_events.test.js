'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { buildCommandName, describeInteraction } = require('../API/command-data');

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

test('describeInteraction identifies each interaction kind', () => {
    const base = { isCommand: () => false, isButton: () => false, isModalSubmit: () => false, isStringSelectMenu: () => false };
    assert.deepStrictEqual(
        describeInteraction({ ...base, isCommand: () => true, ...fakeInteraction('squad', null, 'invite') }),
        { kind: 'command', name: 'squad invite' }
    );
    assert.deepStrictEqual(
        describeInteraction({ ...base, isButton: () => true, customId: 'cdtDownload_9' }),
        { kind: 'button', name: 'cdtDownload_9' }
    );
    assert.deepStrictEqual(
        describeInteraction({ ...base, isModalSubmit: () => true, customId: 'communityDesignerApplicationModal' }),
        { kind: 'modal', name: 'communityDesignerApplicationModal' }
    );
    assert.deepStrictEqual(
        describeInteraction({ ...base, isStringSelectMenu: () => true, customId: 'browseSquads' }),
        { kind: 'select', name: 'browseSquads' }
    );
    assert.deepStrictEqual(describeInteraction(base), { kind: 'unknown', name: '' });
});
