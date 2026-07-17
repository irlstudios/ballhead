'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
    resolveBoards, appendToList, moveItem, removeItem, weightForPosition,
    isValidBoard, MAX_LIST,
} = require('../utils/poll_logic');

const MAP = { gameplay: 'TAG_GP', skins: 'TAG_SK' };
const IDEAS = 'IDEAS_FORUM';
const BUGS = 'BUGS_FORUM';
const base = { gameIdeasForumId: IDEAS, bugsForumId: BUGS, boardTagMap: MAP };

test('resolveBoards maps the bug forum to bugs regardless of tags', () => {
    assert.deepStrictEqual(resolveBoards({ ...base, parentId: BUGS, appliedTags: [] }), ['bugs']);
});

test('resolveBoards maps a gameplay-tagged idea to gameplay', () => {
    assert.deepStrictEqual(resolveBoards({ ...base, parentId: IDEAS, appliedTags: ['TAG_GP'] }), ['gameplay']);
});

test('resolveBoards returns both boards for a dual-tagged idea', () => {
    assert.deepStrictEqual(resolveBoards({ ...base, parentId: IDEAS, appliedTags: ['TAG_GP', 'TAG_SK'] }), ['gameplay', 'skins']);
});

test('resolveBoards returns [] for an untagged idea', () => {
    assert.deepStrictEqual(resolveBoards({ ...base, parentId: IDEAS, appliedTags: [] }), []);
});

test('resolveBoards returns [] for an unrelated channel', () => {
    assert.deepStrictEqual(resolveBoards({ ...base, parentId: 'OTHER', appliedTags: ['TAG_GP'] }), []);
});

test('appendToList adds to the end and does not mutate input', () => {
    const orig = ['a'];
    assert.deepStrictEqual(appendToList(orig, 'b'), { ok: true, reason: null, list: ['a', 'b'] });
    assert.deepStrictEqual(orig, ['a']);
});

test('appendToList rejects a duplicate', () => {
    assert.strictEqual(appendToList(['a'], 'a').ok, false);
    assert.strictEqual(appendToList(['a'], 'a').reason, 'duplicate');
});

test('appendToList rejects when the list is full', () => {
    const full = ['a', 'b', 'c', 'd', 'e'];
    assert.strictEqual(full.length, MAX_LIST);
    assert.strictEqual(appendToList(full, 'f').reason, 'full');
});

test('moveItem up swaps with the previous item', () => {
    assert.deepStrictEqual(moveItem(['a', 'b', 'c'], 2, 'up'), ['a', 'c', 'b']);
});

test('moveItem up at the top is a no-op', () => {
    assert.deepStrictEqual(moveItem(['a', 'b'], 0, 'up'), ['a', 'b']);
});

test('moveItem down at the bottom is a no-op', () => {
    assert.deepStrictEqual(moveItem(['a', 'b'], 1, 'down'), ['a', 'b']);
});

test('removeItem drops the given index', () => {
    assert.deepStrictEqual(removeItem(['a', 'b', 'c'], 1), ['a', 'c']);
});

test('weightForPosition is 6 minus position', () => {
    assert.strictEqual(weightForPosition(1), 5);
    assert.strictEqual(weightForPosition(5), 1);
});

test('isValidBoard accepts the three boards and rejects others', () => {
    assert.ok(isValidBoard('gameplay') && isValidBoard('skins') && isValidBoard('bugs'));
    assert.strictEqual(isValidBoard('nope'), false);
});
