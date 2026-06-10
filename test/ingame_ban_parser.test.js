'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { parseInGameBanMessage } = require('../utils/ingame_ban_parser');

// --- Standard (timed) ban ----------------------------------------------------

test('parses a timed ban with a linked discord id', () => {
    const result = parseInGameBanMessage(
        'ASH CASH ZAY (and discord <@1473500368418640044>) has been banned for 14.0 days by revroy for the following reasons: bullying'
    );
    assert.ok(result);
    assert.strictEqual(result.action, 'Ban');
    assert.strictEqual(result.targetName, 'ASH CASH ZAY');
    assert.strictEqual(result.userId, '1473500368418640044');
    assert.strictEqual(result.moderator, 'revroy');
    assert.strictEqual(result.length, '14.0 days');
    assert.strictEqual(result.reason, 'bullying');
});

test('extracts a nickname-style mention (<@!id>)', () => {
    const result = parseInGameBanMessage(
        'someplayer (and discord <@!1473500368418640044>) has been banned for 1.0 days by mod for the following reasons: x'
    );
    assert.strictEqual(result.userId, '1473500368418640044');
});

// --- Permanent ban -----------------------------------------------------------

test('parses a permanent ban and normalises the length', () => {
    const result = parseInGameBanMessage(
        'someguy (and discord <@1473500368418640044>) has been banned permanently by fwsuperman for the following reasons: username'
    );
    assert.ok(result);
    assert.strictEqual(result.action, 'Ban');
    assert.strictEqual(result.length, 'permanent');
    assert.strictEqual(result.moderator, 'fwsuperman');
    assert.strictEqual(result.reason, 'username');
});

// --- Missing discord link ----------------------------------------------------

test('returns a null user id when the discord mention is empty (<@>)', () => {
    const result = parseInGameBanMessage(
        'NlGGER(KKK) (and discord <@>) has been banned permanently by fwsuperman for the following reasons: username'
    );
    assert.ok(result);
    assert.strictEqual(result.userId, null);
    assert.strictEqual(result.targetName, 'NlGGER(KKK)');
});

// --- In-game name handling ---------------------------------------------------

test('preserves an in-game name containing parentheses and symbols', () => {
    const result = parseInGameBanMessage(
        'NlGGER(KKK) (and discord <@123>) has been banned permanently by mod for the following reasons: username'
    );
    assert.strictEqual(result.targetName, 'NlGGER(KKK)');
    assert.strictEqual(result.userId, '123');
});

test('preserves a multi-word in-game name', () => {
    const result = parseInGameBanMessage(
        'big tall guy (and discord <@123>) has been banned for 2.0 days by mod for the following reasons: spam'
    );
    assert.strictEqual(result.targetName, 'big tall guy');
});

// --- Reason handling ---------------------------------------------------------

test('captures a multi-word reason verbatim', () => {
    const result = parseInGameBanMessage(
        'player (and discord <@123>) has been banned for 3.0 days by mod for the following reasons: toxic in voice chat and spamming'
    );
    assert.strictEqual(result.reason, 'toxic in voice chat and spamming');
});

test('captures a moderator name that contains a space', () => {
    const result = parseInGameBanMessage(
        'player (and discord <@123>) has been banned for 3.0 days by John Doe for the following reasons: spam'
    );
    assert.strictEqual(result.moderator, 'John Doe');
    assert.strictEqual(result.reason, 'spam');
});

// --- Non-matching input ------------------------------------------------------

test('returns null for an unrelated message', () => {
    assert.strictEqual(parseInGameBanMessage('hello world'), null);
    assert.strictEqual(parseInGameBanMessage('someone was warned by a mod'), null);
});

test('returns null for null/undefined/non-string input', () => {
    assert.strictEqual(parseInGameBanMessage(null), null);
    assert.strictEqual(parseInGameBanMessage(undefined), null);
    assert.strictEqual(parseInGameBanMessage(42), null);
});

test('tolerates leading/trailing whitespace around the message', () => {
    const result = parseInGameBanMessage(
        '   player (and discord <@123>) has been banned for 5.0 days by mod for the following reasons: spam   '
    );
    assert.ok(result);
    assert.strictEqual(result.targetName, 'player');
    assert.strictEqual(result.reason, 'spam');
});
