'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const roleCustomize = require('../commands/utility/role_customize');
const { LEAGUE_OWNER_ROLE_ID, BOOSTER_ROLE_ID } = require('../config/constants');
const { RANK_ROLE_IDS } = require('../jobs/rank-role-sync');

const GUILD_ID = 'guild-1';

const member = (...roles) => ({
    guild: { id: GUILD_ID },
    roles: { cache: new Map(roles.map(role => [role.id, role])) },
});

const role = (overrides) => ({ id: 'r1', name: 'Cosmetic', position: 2, managed: false, ...overrides });

test('command exposes a remove action and an autocompleted role option', () => {
    const json = roleCustomize.data.toJSON();
    assert.strictEqual(json.name, 'role-customize');
    const action = json.options.find(o => o.name === 'action');
    const roleOption = json.options.find(o => o.name === 'role');
    assert.deepStrictEqual(action.choices.map(c => c.value), ['remove']);
    assert.strictEqual(roleOption.autocomplete, true);
});

test('only offers roles the member holds that no other system owns', () => {
    const cosmetic = role({ id: 'cosmetic', name: 'Pink', position: 3 });
    const owned = member(
        cosmetic,
        role({ id: GUILD_ID, name: '@everyone', position: 0 }),
        role({ id: 'bot-role', name: 'Integration', position: 4, managed: true }),
        role({ id: LEAGUE_OWNER_ROLE_ID, name: 'League Owner', position: 5 }),
        role({ id: BOOSTER_ROLE_ID, name: 'Booster', position: 6 }),
        role({ id: RANK_ROLE_IDS[0], name: 'Bronze', position: 7 }),
        role({ id: 'above-bot', name: 'Staff', position: 20 }),
    );

    assert.deepStrictEqual(
        roleCustomize.removableRoles(owned, 10).map(r => r.id),
        ['cosmetic']
    );
    assert.strictEqual(roleCustomize.isRemovable(cosmetic, owned, 10), true);
});
