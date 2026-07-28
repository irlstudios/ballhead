'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
    parseThreadName, collectText, parseStatus, extractReporterId, parseReportMessage,
} = require('../utils/reports_backfill');

// Shape discord.js hands back for a Components V2 report post: a container (17)
// holding a text display (10), plus an action row (1) of buttons (2).
const reportMessage = (text, { withButtons = true } = {}) => ({
    content: '',
    components: [
        { type: 17, components: [{ type: 10, content: text }] },
        ...(withButtons
            ? [{
                type: 1,
                components: [
                    { type: 2, customId: 'reportApprove_123456789012345678' },
                    { type: 2, customId: 'reportDeny_123456789012345678' },
                    { type: 2, customId: 'reportInfo_123456789012345678' },
                ],
            }]
            : []),
    ],
});

const OLD_REPORT = [
    '## Player Report: ScrubLord22',
    'Submitted to Gym Class VR moderation',
    '',
    '**Reference ID:** RPT-A1B2C3',
    '**Report From:** roy#0001',
    '**User Reported:** ScrubLord22',
    '**Rule Broken:** Repeatedly shoving players out of the court',
    '**Time of Offense:** 2025-03-10 14:30 UTC',
    '**Lobby Name:** Downtown Court 3',
].join('\n');

test('parseThreadName pulls the reference ID and reported player', () => {
    assert.deepStrictEqual(
        parseThreadName('RPT-A1B2C3 | Report: ScrubLord22'),
        { refId: 'RPT-A1B2C3', reportedName: 'ScrubLord22' }
    );
});

test('parseThreadName keeps spaces inside a reported name', () => {
    assert.strictEqual(parseThreadName('RPT-FFFFFF | Report: Big Bad Wolf').reportedName, 'Big Bad Wolf');
});

test('parseThreadName returns null for an unrelated thread', () => {
    assert.strictEqual(parseThreadName('General chat about rules'), null);
    assert.strictEqual(parseThreadName('RPT-A1B2C3 no player here'), null);
});

test('collectText reaches text nested inside a container', () => {
    assert.strictEqual(collectText(reportMessage('hello').components), 'hello');
});

test('collectText joins every block in order', () => {
    const components = [
        { type: 17, components: [{ type: 10, content: 'first' }] },
        { type: 17, components: [{ type: 10, content: 'second' }] },
    ];
    assert.strictEqual(collectText(components), 'first\nsecond');
});

test('collectText tolerates an empty or missing component list', () => {
    assert.strictEqual(collectText(), '');
    assert.strictEqual(collectText([]), '');
});

test('parseStatus reads open when no status block was appended', () => {
    assert.strictEqual(parseStatus(OLD_REPORT), 'open');
});

test('parseStatus recognises each outcome', () => {
    assert.strictEqual(parseStatus(`${OLD_REPORT}\n## Report Approved`), 'approved');
    assert.strictEqual(parseStatus(`${OLD_REPORT}\n## Report Denied`), 'denied');
    assert.strictEqual(parseStatus(`${OLD_REPORT}\n## More Information Requested`), 'needs_info');
});

test('parseStatus takes the last outcome when a report was actioned twice', () => {
    const text = `${OLD_REPORT}\n## More Information Requested\n## Report Approved`;
    assert.strictEqual(parseStatus(text), 'approved');
});

test('parseStatus is not fooled by the report title itself', () => {
    assert.strictEqual(parseStatus('## Player Report: Report Approved Guy'), 'open');
});

test('extractReporterId recovers the reporter from the action buttons', () => {
    assert.strictEqual(
        extractReporterId(reportMessage(OLD_REPORT).components),
        '123456789012345678'
    );
});

test('extractReporterId returns null once the buttons have been stripped', () => {
    assert.strictEqual(
        extractReporterId(reportMessage(OLD_REPORT, { withButtons: false }).components),
        null
    );
});

test('extractReporterId reads snake_case custom IDs from raw API payloads', () => {
    const components = [{ type: 1, components: [{ type: 2, custom_id: 'reportDeny_42' }] }];
    assert.strictEqual(extractReporterId(components), '42');
});

test('parseReportMessage reconstructs an old report with no severity', () => {
    const parsed = parseReportMessage(reportMessage(OLD_REPORT));
    assert.deepStrictEqual(parsed, {
        reporterId: '123456789012345678',
        reporterTag: 'roy#0001',
        severity: 'other',
        ruleBroken: 'Repeatedly shoving players out of the court',
        timeOfOffense: '2025-03-10 14:30 UTC',
        lobbyName: 'Downtown Court 3',
        proofDescription: null,
        proofUrl: null,
        status: 'open',
    });
});

test('parseReportMessage maps a severity label written by the new command', () => {
    const text = `${OLD_REPORT}\n**Severity:** Hate speech or slurs`;
    assert.strictEqual(parseReportMessage(reportMessage(text)).severity, 'hate');
});

test('parseReportMessage picks up the new proof fields', () => {
    const text = [
        OLD_REPORT,
        '**Proof Shows:** He shoves at 0:42 and again at 1:10.',
        '**Proof Link:** https://medal.tv/clips/abc',
    ].join('\n');
    const parsed = parseReportMessage(reportMessage(text));
    assert.strictEqual(parsed.proofDescription, 'He shoves at 0:42 and again at 1:10.');
    assert.strictEqual(parsed.proofUrl, 'https://medal.tv/clips/abc');
});

test('parseReportMessage returns nulls rather than throwing on an unparseable body', () => {
    const parsed = parseReportMessage(reportMessage('this post was edited into nothing useful'));
    assert.strictEqual(parsed.ruleBroken, null);
    assert.strictEqual(parsed.status, 'open');
});

test('parseReportMessage tolerates a message with no components at all', () => {
    const parsed = parseReportMessage({});
    assert.strictEqual(parsed.reporterId, null);
    assert.strictEqual(parsed.severity, 'other');
});

// A status block lives in its own container appended after the report, so the
// outcome must never be read out of anything the reporter typed.
const stamped = (reportText, statusText) => ({
    components: [
        { type: 17, components: [{ type: 10, content: reportText }] },
        { type: 17, components: [{ type: 10, content: statusText }] },
    ],
});

test('a reporter cannot approve their own report by typing the status heading', () => {
    const hostile = OLD_REPORT.replace(
        '**Rule Broken:** Repeatedly shoving players out of the court',
        '**Rule Broken:** nothing really\n## Report Approved'
    );
    assert.strictEqual(parseReportMessage(reportMessage(hostile)).status, 'open');
});

test('a real appended status block is still read', () => {
    assert.strictEqual(parseReportMessage(stamped(OLD_REPORT, '## Report Denied')).status, 'denied');
});

test('a field label typed mid-sentence does not override the real field', () => {
    const hostile = [
        '**Reference ID:** RPT-A1B2C3',
        '**Rule Broken:** he said **Proof Link:** https://evil.example to me',
        '**Proof Link:** https://medal.tv/clips/real',
    ].join('\n');
    assert.strictEqual(parseReportMessage(reportMessage(hostile)).proofUrl, 'https://medal.tv/clips/real');
});

test('a field with an empty value reads as null rather than an empty string', () => {
    assert.strictEqual(parseReportMessage(reportMessage('**Rule Broken:**   ')).ruleBroken, null);
});
