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
