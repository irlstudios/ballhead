'use strict';

// One-time (and safely re-runnable) import of the reports that existed as forum
// threads before reports were indexed. Every parser here is pure so the awkward
// part - reading structure back out of posted messages - is unit tested.

const logger = require('./logger');
const { REPORTS_FORUM_CHANNEL_ID } = require('../config/constants');
const { insertPlayerReport } = require('./reports_queries');
const { SEVERITIES } = require('./reports_logic');

const parseThreadName = (name) => {
    const refMatch = (name || '').match(/RPT-[A-F0-9]{6}/);
    const nameMatch = (name || '').match(/Report:\s*(.+)$/i);
    if (!refMatch || !nameMatch) {
        return null;
    }
    return { refId: refMatch[0], reportedName: nameMatch[1].trim() };
};

// Report posts are Components V2, so message.content is empty and the text lives
// in nested TextDisplay components. Walks whatever shape discord.js hands back.
const collectText = (components = []) => {
    const parts = [];
    const walk = (list) => {
        for (const component of list || []) {
            if (typeof component?.content === 'string') {
                parts.push(component.content);
            }
            if (Array.isArray(component?.components)) {
                walk(component.components);
            }
        }
    };
    walk(components);
    return parts.join('\n');
};

// Anchored to the start of a line so a label typed mid-sentence inside someone's
// rule description cannot masquerade as a field. A reporter can still put a fake
// field on its own line, but only in their own report, where they wrote the real
// values anyway. Captures one line: a pasted multi-line value keeps its first.
const field = (text, label) => {
    const match = (text || '').match(new RegExp(`^\\*\\*${label}:\\*\\*\\s*(.*)$`, 'm'));
    const value = match ? match[1].trim() : '';
    return value || null;
};

const SEVERITY_BY_LABEL = Object.fromEntries(SEVERITIES.map((s) => [s.label.toLowerCase(), s.value]));

// The status block is appended below the original report, so the last one wins:
// a report sent back for information and later approved reads as approved.
const parseStatus = (text) => {
    const markers = [
        { pattern: /##\s*Report Approved/g, status: 'approved' },
        { pattern: /##\s*Report Denied/g, status: 'denied' },
        { pattern: /##\s*More Information Requested/g, status: 'needs_info' },
    ];
    let latest = { status: 'open', index: -1 };
    for (const marker of markers) {
        for (const match of (text || '').matchAll(marker.pattern)) {
            if (match.index > latest.index) {
                latest = { status: marker.status, index: match.index };
            }
        }
    }
    return latest.status;
};

// The reporter's ID was only ever stored in the action buttons' custom IDs. Those
// buttons are stripped once a report is actioned, so resolved historical reports
// lose their reporter. Open ones - the only ones the queue shows - keep theirs.
const extractReporterId = (components = []) => {
    let found = null;
    const walk = (list) => {
        for (const component of list || []) {
            const customId = component?.customId || component?.custom_id;
            const match = typeof customId === 'string' && customId.match(/^report(?:Approve|Deny|Info)_(\d+)$/);
            if (match && !found) {
                found = match[1];
            }
            if (Array.isArray(component?.components)) {
                walk(component.components);
            }
        }
    };
    walk(components);
    return found;
};

const parseReportMessage = (message) => {
    const components = message?.components || [];
    const text = collectText(components);
    // The outcome is read only from the containers appended after the report.
    // Scanning the whole post would let a reporter close their own report by
    // typing "## Report Approved" into the rule description.
    const outcomeText = collectText(components.slice(1));
    const severityLabel = (field(text, 'Severity') || '').toLowerCase();
    return {
        reporterId: extractReporterId(components),
        reporterTag: field(text, 'Report From'),
        severity: SEVERITY_BY_LABEL[severityLabel] || 'other',
        ruleBroken: field(text, 'Rule Broken'),
        timeOfOffense: field(text, 'Time of Offense'),
        lobbyName: field(text, 'Lobby Name'),
        proofDescription: field(text, 'Proof Shows'),
        proofUrl: field(text, 'Proof Link'),
        status: parseStatus(outcomeText),
    };
};

const collectThreads = async (forum, maxThreads) => {
    const threads = [];
    const active = await forum.threads.fetchActive();
    threads.push(...active.threads.values());

    let before;
    // Bounded rather than while(hasMore): a stuck cursor would otherwise spin
    // against the API forever.
    for (let page = 0; page < 20 && threads.length < maxThreads; page++) {
        const archived = await forum.threads.fetchArchived({ limit: 100, before });
        const batch = [...archived.threads.values()];
        if (batch.length === 0) {
            break;
        }
        threads.push(...batch);
        before = batch[batch.length - 1].id;
        if (!archived.hasMore) {
            break;
        }
    }
    return threads.slice(0, maxThreads);
};

// Re-runnable: inserts use ON CONFLICT DO NOTHING, so a second run only picks up
// what the first one missed or could not reach within its cap.
const backfillReports = async (guild, { maxThreads = 200 } = {}) => {
    const forum = await guild.channels.fetch(REPORTS_FORUM_CHANNEL_ID);
    if (!forum) {
        throw new Error('The forum channel for reports could not be found.');
    }

    const threads = await collectThreads(forum, maxThreads);
    const result = { scanned: threads.length, inserted: 0, existing: 0, skipped: 0 };

    for (const thread of threads) {
        const parsedName = parseThreadName(thread.name);
        if (!parsedName) {
            result.skipped++;
            continue;
        }

        let message = null;
        try {
            message = await thread.fetchStarterMessage();
        } catch {
            message = null;
        }
        if (!message) {
            result.skipped++;
            continue;
        }

        const parsed = parseReportMessage(message);
        try {
            const inserted = await insertPlayerReport({
                refId: parsedName.refId,
                reportedName: parsedName.reportedName,
                threadId: thread.id,
                threadUrl: thread.url,
                createdAt: thread.createdAt,
                ...parsed,
            });
            if (inserted) {
                result.inserted++;
            } else {
                result.existing++;
            }
        } catch (error) {
            logger.error(`Backfill failed for ${parsedName.refId}:`, error.message);
            result.skipped++;
        }
    }

    return result;
};

module.exports = {
    parseThreadName,
    collectText,
    parseStatus,
    extractReporterId,
    parseReportMessage,
    backfillReports,
};
