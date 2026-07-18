'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { buildDirectoryLines } = require('../utils/league_directory');

test('empty directory yields a placeholder line', () => {
    assert.deepStrictEqual(buildDirectoryLines([]), ['No leagues are currently listed.']);
    assert.deepStrictEqual(buildDirectoryLines(null), ['No leagues are currently listed.']);
});

test('groups leagues under tier headers in order', () => {
    const leagues = [
        { league_name: 'Alpha', league_type: 'Sponsored', health_status: 'Healthy' },
        { league_name: 'Beta', league_type: 'Base', health_status: 'Healthy' },
        { league_name: 'Gamma', league_type: 'Active', health_status: 'Healthy' },
    ];
    const lines = buildDirectoryLines(leagues);
    const sponsoredIdx = lines.indexOf('**Sponsored Leagues**');
    const activeIdx = lines.indexOf('**Active Leagues**');
    const baseIdx = lines.indexOf('**Base Leagues**');
    assert.ok(sponsoredIdx >= 0 && activeIdx > sponsoredIdx && baseIdx > activeIdx);
});

test('links the name when an invite is present and shows member count', () => {
    const lines = buildDirectoryLines([
        { league_name: 'Alpha', league_type: 'Active', league_invite: 'https://discord.gg/x', member_count: 120, health_status: 'Healthy' },
    ]);
    assert.ok(lines.some((l) => l.includes('[Alpha](https://discord.gg/x)') && l.includes('120 members')));
});

test('surfaces a non-healthy status but hides Healthy', () => {
    const risky = buildDirectoryLines([{ league_name: 'Risky', league_type: 'Active', health_status: 'At Risk' }]);
    assert.ok(risky.some((l) => l.includes('At Risk')));
    const healthy = buildDirectoryLines([{ league_name: 'Fine', league_type: 'Active', health_status: 'Healthy' }]);
    assert.ok(!healthy.some((l) => l.includes('Healthy')));
});

test('omits empty tiers', () => {
    const lines = buildDirectoryLines([{ league_name: 'Solo', league_type: 'Base', health_status: 'Healthy' }]);
    assert.ok(!lines.includes('**Sponsored Leagues**'));
    assert.ok(!lines.includes('**Active Leagues**'));
    assert.ok(lines.includes('**Base Leagues**'));
});
