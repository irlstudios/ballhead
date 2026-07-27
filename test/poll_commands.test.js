'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const myideas = require('../commands/poll/myideas');

test('myideas exposes add and view subcommands', () => {
    const json = myideas.data.toJSON();
    assert.strictEqual(json.name, 'myideas');
    const subs = json.options.map((o) => o.name);
    assert.ok(subs.includes('add'));
    assert.ok(subs.includes('view'));
});

test('myideas add has an autocomplete post option and a 3-choice board', () => {
    const json = myideas.data.toJSON();
    const add = json.options.find((o) => o.name === 'add');
    const post = add.options.find((o) => o.name === 'post');
    const board = add.options.find((o) => o.name === 'board');
    assert.strictEqual(post.autocomplete, true);
    assert.strictEqual(board.choices.length, 3);
});

test('myideas provides an autocomplete handler', () => {
    assert.strictEqual(typeof myideas.autocomplete, 'function');
});

const leaderboard = require('../commands/poll/leaderboard');

test('leaderboard has a 3-choice board option', () => {
    const json = leaderboard.data.toJSON();
    assert.strictEqual(json.name, 'leaderboard');
    const board = json.options.find((o) => o.name === 'board');
    assert.strictEqual(board.choices.length, 3);
});

const addMenu = require('../commands/poll/add-to-top5');

test('add-to-top5 is a message context menu command', () => {
    const json = addMenu.data.toJSON();
    assert.strictEqual(json.name, 'Add to my Top 5');
    assert.strictEqual(json.type, 3); // ApplicationCommandType.Message
});

const { buildNudge, buildBoardPicker } = require('../utils/poll_view');

// The nudge button must stay on the poll: prefix (interactionHandler routes on it)
// and carry no board, so handlePollButton resolves the thread's boards at click time.
const nudgeButtons = (payload) => payload.components
    .flatMap((c) => c.toJSON().components || [])
    .filter((c) => typeof c.custom_id === 'string');

test('nudge carries a single bare poll:add button', () => {
    const buttons = nudgeButtons(buildNudge(['gameplay']));
    assert.deepStrictEqual(buttons.map((b) => b.custom_id), ['poll:add']);
});

test('nudge names the board only when the post is in exactly one', () => {
    const text = (payload) => JSON.stringify(payload.components[0].toJSON());
    assert.match(text(buildNudge(['skins'])), /Top 5 Skins/);
    assert.doesNotMatch(text(buildNudge(['gameplay', 'skins'])), /Top 5 \w/);
    assert.doesNotMatch(text(buildNudge([])), /Top 5 \w/);
});

// A post in two boards cannot be resolved to one list, so the click has to offer a
// choice. These ids are what handlePollButton parses as poll:<action>:<board>.
test('the board picker offers one labelled button per board', () => {
    const payload = buildBoardPicker(['gameplay', 'skins']);
    const buttons = nudgeButtons(payload);
    assert.deepStrictEqual(buttons.map((b) => b.custom_id), ['poll:add:gameplay', 'poll:add:skins']);
    assert.deepStrictEqual(buttons.map((b) => b.label), ['Gameplay', 'Skins']);
});
