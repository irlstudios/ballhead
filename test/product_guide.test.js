'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { GUIDE_TOPICS, buildGuidePage, buildOverviewPage } = require('../utils/product_guide');

const KNOWN_COMMAND_PREFIXES = ['guide', 'squad', 'league', 'apply', 'cc', 'cdt', 'ff', 'room', 'report', 'officials', 'role-customize'];

test('every topic renders a titled page with content', () => {
    for (const topic of Object.keys(GUIDE_TOPICS)) {
        const page = buildGuidePage(topic);
        assert.ok(page.title.length > 0, `${topic} has a title`);
        assert.ok(page.lines.length >= 3, `${topic} has content`);
        assert.ok(page.lines.join('\n').length < 3500, `${topic} fits one text display`);
    }
});

test('unknown topics fall back to the overview', () => {
    assert.deepStrictEqual(buildGuidePage('nonsense'), buildOverviewPage());
});

test('overview mentions every topic', () => {
    const overview = buildOverviewPage().lines.join('\n');
    for (const topic of Object.keys(GUIDE_TOPICS)) {
        assert.ok(overview.includes(topic), `overview lists ${topic}`);
    }
});

test('every advertised command uses a real command prefix', () => {
    const pages = [buildOverviewPage(), ...Object.keys(GUIDE_TOPICS).map(buildGuidePage)];
    const advertised = pages.flatMap((page) => [...page.lines.join('\n').matchAll(/\*\*\/([a-z-]+)/g)].map((m) => m[1]));
    assert.ok(advertised.length > 10, 'guide actually advertises commands');
    for (const cmd of advertised) {
        assert.ok(KNOWN_COMMAND_PREFIXES.includes(cmd), `unknown command advertised: /${cmd}`);
    }
});
