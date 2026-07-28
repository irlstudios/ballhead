'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
    validateReportProof, scoreReport, sortByPriority, formatAge, severityLabel,
} = require('../utils/reports_logic');

const DESCRIPTION = 'He spams slurs in voice chat at about 40 seconds in.';
const IMAGE = { contentType: 'image/png', url: 'https://cdn.discordapp.com/a.png' };
const VIDEO = { contentType: 'video/mp4', url: 'https://cdn.discordapp.com/a.mp4' };

test('proof is rejected when neither an attachment nor a link is given', () => {
    const result = validateReportProof({ description: DESCRIPTION });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'missing');
});

test('an image attachment alone is enough', () => {
    assert.strictEqual(validateReportProof({ attachment: IMAGE, description: DESCRIPTION }).ok, true);
});

test('a video attachment alone is enough', () => {
    assert.strictEqual(validateReportProof({ attachment: VIDEO, description: DESCRIPTION }).ok, true);
});

test('a link alone is enough and comes back normalised', () => {
    const result = validateReportProof({ link: '  https://medal.tv/clips/abc  ', description: DESCRIPTION });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.link, 'https://medal.tv/clips/abc');
});

test('a non-media attachment is rejected rather than silently re-uploaded', () => {
    const result = validateReportProof({
        attachment: { contentType: 'application/pdf' },
        description: DESCRIPTION,
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'bad-attachment');
});

test('a non-URL link is rejected', () => {
    assert.strictEqual(validateReportProof({ link: 'medal lol', description: DESCRIPTION }).reason, 'bad-link');
});

test('a non-http protocol is rejected', () => {
    assert.strictEqual(
        validateReportProof({ link: 'javascript:alert(1)', description: DESCRIPTION }).reason,
        'bad-link'
    );
});

test('a too-short description is rejected even with good proof', () => {
    const result = validateReportProof({ attachment: IMAGE, description: 'he cheated' });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'short-description');
});

test('a whitespace-only description is rejected', () => {
    assert.strictEqual(validateReportProof({ attachment: IMAGE, description: '        ' }).reason, 'short-description');
});

const NOW = Date.parse('2026-07-27T12:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3600000).toISOString();

const row = (overrides = {}) => ({
    severity: 'other',
    other_open_count: 0,
    reporter_approved: 0,
    reporter_denied: 0,
    created_at: hoursAgo(0),
    ...overrides,
});

test('severity is the base of the score', () => {
    assert.strictEqual(scoreReport(row({ severity: 'hate' }), NOW), 35);
    assert.strictEqual(scoreReport(row({ severity: 'griefing' }), NOW), 10);
    assert.strictEqual(scoreReport(row({ severity: 'other' }), NOW), 5);
});

test('an unknown severity falls back to the lowest weight', () => {
    assert.strictEqual(scoreReport(row({ severity: 'nonsense' }), NOW), 5);
});

test('each other open report on the same player adds weight', () => {
    assert.strictEqual(scoreReport(row({ other_open_count: 3 }), NOW), 5 + 24);
});

test('the repeat signal is capped so one player cannot bury the queue', () => {
    assert.strictEqual(scoreReport(row({ other_open_count: 100 }), NOW), 5 + 40);
});

test('a trusted reporter is boosted and a serial false-reporter is sunk', () => {
    assert.strictEqual(scoreReport(row({ reporter_approved: 4 }), NOW), 9);
    assert.strictEqual(scoreReport(row({ reporter_denied: 4 }), NOW), 1);
});

test('the reporter record is clamped in both directions', () => {
    assert.strictEqual(scoreReport(row({ reporter_approved: 500 }), NOW), 20);
    assert.strictEqual(scoreReport(row({ reporter_denied: 500 }), NOW), -10);
});

test('waiting adds weight, capped at five days', () => {
    assert.strictEqual(scoreReport(row({ created_at: hoursAgo(12) }), NOW), 7);
    assert.strictEqual(scoreReport(row({ created_at: hoursAgo(24 * 100) }), NOW), 35);
});

test('a report from the future never scores negative age', () => {
    assert.strictEqual(scoreReport(row({ created_at: hoursAgo(-50) }), NOW), 5);
});

test('sortByPriority puts the highest score first', () => {
    const sorted = sortByPriority([
        row({ ref_id: 'low', severity: 'other' }),
        row({ ref_id: 'high', severity: 'hate' }),
        row({ ref_id: 'mid', severity: 'cheating' }),
    ], NOW);
    assert.deepStrictEqual(sorted.map(r => r.ref_id), ['high', 'mid', 'low']);
});

test('sortByPriority breaks ties in favour of the report that has waited longer', () => {
    // Both score 7: one from age, one from a reporter with two approvals.
    const sorted = sortByPriority([
        row({ ref_id: 'newer', reporter_approved: 2, created_at: hoursAgo(0) }),
        row({ ref_id: 'older', created_at: hoursAgo(12) }),
    ], NOW);
    assert.deepStrictEqual(sorted.map(r => r.score), [7, 7]);
    assert.deepStrictEqual(sorted.map(r => r.ref_id), ['older', 'newer']);
});

test('sortByPriority does not mutate its input', () => {
    const input = [row({ ref_id: 'a', severity: 'other' }), row({ ref_id: 'b', severity: 'hate' })];
    sortByPriority(input, NOW);
    assert.deepStrictEqual(input.map(r => r.ref_id), ['a', 'b']);
    assert.strictEqual(input[0].score, undefined);
});

test('formatAge reads in hours then days', () => {
    assert.strictEqual(formatAge(hoursAgo(0.5), NOW), 'under an hour');
    assert.strictEqual(formatAge(hoursAgo(5), NOW), '5h');
    assert.strictEqual(formatAge(hoursAgo(72), NOW), '3d');
});

test('severityLabel falls back to Other for unknown values', () => {
    assert.strictEqual(severityLabel('hate'), 'Hate speech or slurs');
    assert.strictEqual(severityLabel('bogus'), 'Other');
});
