'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { buildBrowsePages, PAGE_SIZE } = require('../commands/squads/squad_browse');

const squad = (over) => ({
    id: 1, name: 'ABC', squad_type: 'Casual', owner_id: 'o', member_count: 3,
    description: null, playstyle: null, region: null, recruiting: 'Invite-only', ...over,
});

test('pages hold 5 squads and mark joinable ones', () => {
    const squads = Array.from({ length: 7 }, (_, i) => squad({ id: i + 1, name: `SQ${i}`, recruiting: i % 2 ? 'Open' : 'Invite-only' }));
    const pages = buildBrowsePages(squads);
    assert.strictEqual(pages.length, 2);
    assert.strictEqual(pages[0].entries.length, PAGE_SIZE);
    assert.strictEqual(pages[1].entries.length, 2);
    for (const entry of pages[0].entries) {
        assert.strictEqual(entry.joinable, entry.squad.recruiting === 'Open');
    }
});

test('full squads and invite-only squads are not joinable; null recruiting reads invite-only', () => {
    const pages = buildBrowsePages([
        squad({ id: 1, recruiting: 'Open', member_count: 9 }),
        squad({ id: 2, name: 'XYZ', recruiting: 'Apply', member_count: 2 }),
        squad({ id: 3, name: 'QQQ', recruiting: null }),
    ]);
    const [full, apply, legacy] = pages[0].entries;
    assert.strictEqual(full.joinable, false);
    assert.strictEqual(apply.joinable, true);
    assert.strictEqual(legacy.joinable, false);
    assert.match(legacy.lines.join('\n'), /Invite-only/);
});

test('entry lines carry profile fields and capacity, no wins language', () => {
    const pages = buildBrowsePages([squad({
        id: 4, name: 'PROS', squad_type: 'Competitive', recruiting: 'Apply',
        description: 'We scrim nightly', playstyle: 'Grind', region: 'EU', member_count: 5,
    })]);
    const text = pages[0].entries[0].lines.join('\n');
    assert.match(text, /PROS/);
    assert.match(text, /6\/10/);
    assert.match(text, /Grind/);
    assert.match(text, /EU/);
    assert.match(text, /We scrim nightly/);
    assert.match(text, /Apply/);
    assert.ok(!/win|level/i.test(text));
});

test('empty input produces no pages', () => {
    assert.deepStrictEqual(buildBrowsePages([]), []);
});
