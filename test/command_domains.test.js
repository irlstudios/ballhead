'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { COMMAND_DOMAINS, groupCommandsByDomain } = require('../utils/command_domains');

const fakeModule = (name, { options = [], execute, autocomplete } = {}) => ({
    data: { name, toJSON: () => ({ name, description: `${name} description`, options }) },
    execute: execute || (async () => `ran ${name}`),
    ...(autocomplete ? { autocomplete } : {}),
});

const fakeInteraction = (sub, group = null) => ({
    options: {
        getSubcommand: () => sub,
        getSubcommandGroup: () => group,
    },
});

test('folds domain-prefixed commands into one top-level command', () => {
    const commands = groupCommandsByDomain([
        fakeModule('squad-invite'),
        fakeModule('squad-leave'),
        fakeModule('community-metrics'),
    ]);
    assert.ok(commands.has('squad'), 'squad domain registered');
    assert.ok(commands.has('community-metrics'), 'unmatched command stays flat');
    assert.ok(!commands.has('squad-invite'), 'folded name no longer registered');

    const json = commands.get('squad').data.toJSON();
    assert.strictEqual(json.name, 'squad');
    assert.strictEqual(json.description, COMMAND_DOMAINS.squad);
    assert.deepStrictEqual(json.options.map(o => [o.type, o.name]).sort(), [[1, 'invite'], [1, 'leave']]);
});

test('a command with its own subcommands becomes a subcommand group', () => {
    const withSubs = fakeModule('league-official-roster', {
        options: [{ type: 1, name: 'add', description: 'x', options: [] }],
    });
    const commands = groupCommandsByDomain([withSubs, fakeModule('league-checkin')]);
    const json = commands.get('league').data.toJSON();
    const group = json.options.find(o => o.name === 'official-roster');
    assert.strictEqual(group.type, 2);
    assert.deepStrictEqual(group.options.map(o => o.name), ['add']);
});

test('a single-member domain stays flat', () => {
    const commands = groupCommandsByDomain([fakeModule('ff-stats')]);
    assert.ok(commands.has('ff-stats'));
    assert.ok(!commands.has('ff'));
});

test('dispatcher routes execute and autocomplete to the right module', async () => {
    let ranAuto = null;
    const commands = groupCommandsByDomain([
        fakeModule('squad-invite', { autocomplete: async () => { ranAuto = 'invite'; } }),
        fakeModule('squad-leave'),
        fakeModule('squad-roster', { options: [{ type: 1, name: 'view', description: 'x', options: [] }] }),
    ]);
    const squad = commands.get('squad');
    assert.strictEqual(await squad.execute(fakeInteraction('invite')), 'ran squad-invite');
    assert.strictEqual(await squad.execute(fakeInteraction('view', 'roster')), 'ran squad-roster');
    await squad.autocomplete(fakeInteraction('invite'));
    assert.strictEqual(ranAuto, 'invite');
    await squad.autocomplete(fakeInteraction('leave'));
});

test('autocomplete routes through subcommand groups', async () => {
    let ran = null;
    const grouped = fakeModule('squad-roster', {
        options: [{ type: 1, name: 'add', description: 'x', options: [] }],
        autocomplete: async () => { ran = 'roster'; },
    });
    const commands = groupCommandsByDomain([grouped, fakeModule('squad-invite')]);
    await commands.get('squad').autocomplete(fakeInteraction('add', 'roster'));
    assert.strictEqual(ran, 'roster');
});

test('resolveSubcommand exposes the routed module for cooldown keying', () => {
    const invite = fakeModule('squad-invite');
    invite.cooldown = 604800;
    const commands = groupCommandsByDomain([invite, fakeModule('squad-leave')]);
    const resolved = commands.get('squad').resolveSubcommand(fakeInteraction('invite'));
    assert.strictEqual(resolved, invite);
    assert.strictEqual(resolved.cooldown, 604800);
});

test('duplicate subcommand names in one domain throw at load time', () => {
    assert.throws(
        () => groupCommandsByDomain([fakeModule('squad-invite'), fakeModule('squad-invite')]),
        /duplicate/i
    );
});

test('dropped default permissions never reach the domain json', () => {
    const withPerms = {
        data: {
            name: 'league-overview',
            toJSON: () => ({
                name: 'league-overview', description: 'staff view',
                options: [], default_member_permissions: '8',
            }),
        },
        execute: async () => {},
    };
    const commands = groupCommandsByDomain([withPerms, fakeModule('league-checkin')]);
    const json = commands.get('league').data.toJSON();
    const sub = json.options.find(o => o.name === 'overview');
    assert.strictEqual(sub.default_member_permissions, undefined);
});
