'use strict';

const moment = require('moment-timezone');
const logger = require('../utils/logger');
const { getSheetsClient } = require('../utils/sheets_cache');
const { getGameIdeasSummary } = require('../db');
const {
    BUG_REPORTS_FORUM_CHANNEL_ID,
    BUG_REPORT_ESCALATED_TAG_ID,
    SPREADSHEET_COMMUNITY_METRICS,
} = require('../config/constants');

const TIMEZONE = 'America/Chicago';

// All metrics are appended as one row per run into the existing "Data" tab.
// Both game-ideas and bug columns are scoped to the date range; bug columns
// count threads opened in the range that are still open.
const DATA_TAB = Object.freeze({
    title: 'Data',
    headers: [
        'Generated At', 'Range Start', 'Range End',
        'Game Ideas Threads', 'Game Ideas Messages', 'Unique Participants',
        'Bug Opened In Range', 'Bug Opened In Range Escalated', 'Bug Opened In Range Un-escalated',
    ],
});

const formatTimestamp = (value) => {
    if (!value) {
        return '';
    }
    const m = moment.tz(value, TIMEZONE);
    return m.isValid() ? m.format('YYYY-MM-DD HH:mm') : '';
};

const getGameIdeasMetrics = async (start, end) => {
    return getGameIdeasSummary(start, end);
};

const isEscalatedThread = (thread) => {
    const appliedTags = Array.isArray(thread.appliedTags) ? thread.appliedTags : [];
    return appliedTags.includes(BUG_REPORT_ESCALATED_TAG_ID);
};

// Bug metrics are scoped to the date range: threads CREATED within [start, end]
// that are still open. "Open" = currently-active (non-archived) and not closed
// via the forum's close button (closing archives + locks; auto-archive also
// removes inactive posts). The unreliable "Closed" tag is ignored.
const getBugReportMetrics = async (client, start, end) => {
    const startMs = start.getTime();
    const endMs = end.getTime();

    const forumChannel = await client.channels.fetch(BUG_REPORTS_FORUM_CHANNEL_ID).catch(() => null);
    if (!forumChannel || typeof forumChannel.threads?.fetchActive !== 'function') {
        logger.error(`[CommunityMetrics] Bug reports forum '${BUG_REPORTS_FORUM_CHANNEL_ID}' not found or not a forum.`);
        return { openInRange: 0, openInRangeEscalated: 0, openInRangeUnescalated: 0, unavailable: true };
    }

    const active = [...(await forumChannel.threads.fetchActive()).threads.values()];
    const openInRange = active.filter((thread) => {
        if (thread.locked) {
            return false;
        }
        const created = thread.createdTimestamp;
        return typeof created === 'number' && created >= startMs && created <= endMs;
    });

    const escalated = openInRange.filter(isEscalatedThread).length;
    return {
        openInRange: openInRange.length,
        openInRangeEscalated: escalated,
        openInRangeUnescalated: openInRange.length - escalated,
        unavailable: false,
    };
};

// True if the Data tab already has a row whose "Range End" (column C, index 2)
// equals the given formatted timestamp. Guards against duplicate appends for the
// same reporting window: a manual /community-metrics run after the weekly cron,
// a re-run of the same range, or two bot instances firing the same Monday job.
const hasRowForRangeEnd = (existingRows, rangeEnd) => {
    if (!rangeEnd || !Array.isArray(existingRows)) {
        return false;
    }
    return existingRows.some((row) => Array.isArray(row) && row[2] === rangeEnd);
};

// Ensures the "Data" tab exists and has a header row before any append.
const ensureDataTab = async (sheets) => {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_COMMUNITY_METRICS });
    const exists = (meta.data.sheets || []).some((s) => s.properties.title === DATA_TAB.title);

    if (!exists) {
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_COMMUNITY_METRICS,
            resource: { requests: [{ addSheet: { properties: { title: DATA_TAB.title } } }] },
        });
        logger.info(`[CommunityMetrics] Created sheet tab: ${DATA_TAB.title}`);
    }

    const header = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_COMMUNITY_METRICS,
        range: `${DATA_TAB.title}!A1:I1`,
    });
    const hasHeader = Array.isArray(header.data.values)
        && header.data.values.length > 0
        && (header.data.values[0] || []).length > 0;

    if (!hasHeader) {
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_COMMUNITY_METRICS,
            range: `${DATA_TAB.title}!A1`,
            valueInputOption: 'RAW',
            resource: { values: [DATA_TAB.headers] },
        });
        logger.info(`[CommunityMetrics] Wrote header row to ${DATA_TAB.title}`);
    }
};

// Appends one metrics row, unless a row for the same Range End already exists.
// Returns { appended, skipped } so callers can distinguish a real write from a
// no-op duplicate guard.
const appendMetricsToSheet = async (metrics) => {
    const sheets = await getSheetsClient();
    await ensureDataTab(sheets);

    const rangeEnd = formatTimestamp(metrics.range.end);
    const existing = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_COMMUNITY_METRICS,
        range: `${DATA_TAB.title}!C:C`,
    });

    if (hasRowForRangeEnd(existing.data.values, rangeEnd)) {
        logger.info(`[CommunityMetrics] Skipped append; a row for range end '${rangeEnd}' already exists.`);
        return { appended: false, skipped: true };
    }

    const row = [
        formatTimestamp(new Date()),
        formatTimestamp(metrics.range.start),
        rangeEnd,
        metrics.gameIdeas.threadCount,
        metrics.gameIdeas.messageCount,
        metrics.gameIdeas.uniqueParticipants,
        metrics.bugReports.openInRange,
        metrics.bugReports.openInRangeEscalated,
        metrics.bugReports.openInRangeUnescalated,
    ];

    await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_COMMUNITY_METRICS,
        range: `${DATA_TAB.title}!A:I`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [row] },
    });

    return { appended: true, skipped: false };
};

// Computes the full metrics set for a date range and optionally appends to the sheet.
// Each source is isolated: a failure in one (e.g. a DB hiccup) still lets the other
// be reported and the sheet row to be written.
const runCommunityMetrics = async (client, { start, end, appendSheet = false } = {}) => {
    const [gameIdeasResult, bugReportsResult] = await Promise.allSettled([
        getGameIdeasMetrics(start, end),
        getBugReportMetrics(client, start, end),
    ]);

    let gameIdeas;
    if (gameIdeasResult.status === 'fulfilled') {
        gameIdeas = gameIdeasResult.value;
    } else {
        logger.error('[CommunityMetrics] Failed to read game ideas metrics:', gameIdeasResult.reason);
        gameIdeas = { threadCount: 0, messageCount: 0, uniqueParticipants: 0, unavailable: true };
    }

    let bugReports;
    if (bugReportsResult.status === 'fulfilled') {
        bugReports = bugReportsResult.value;
    } else {
        logger.error('[CommunityMetrics] Failed to read bug report metrics:', bugReportsResult.reason);
        bugReports = { openInRange: 0, openInRangeEscalated: 0, openInRangeUnescalated: 0, unavailable: true };
    }

    const metrics = { range: { start, end }, gameIdeas, bugReports, appended: false, appendSkipped: false, appendError: null };

    if (appendSheet) {
        try {
            const result = await appendMetricsToSheet(metrics);
            metrics.appended = result.appended;
            metrics.appendSkipped = result.skipped;
        } catch (error) {
            metrics.appendError = error.message;
            logger.error('[CommunityMetrics] Failed to append metrics to sheet:', error);
        }
    }

    return metrics;
};

// Weekly cron entry point: summarizes the trailing 7 days and appends to the sheet.
const runWeeklyCommunityMetrics = async (client) => {
    const end = new Date();
    const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    const metrics = await runCommunityMetrics(client, { start, end, appendSheet: true });
    logger.info(
        `[CommunityMetrics] Weekly run complete. Game ideas: ${metrics.gameIdeas.threadCount} threads, ` +
        `${metrics.gameIdeas.uniqueParticipants} participants. Bug reports (opened in range, still open): ` +
        `${metrics.bugReports.openInRange} total, ${metrics.bugReports.openInRangeEscalated} escalated, ` +
        `${metrics.bugReports.openInRangeUnescalated} un-escalated. Appended: ${metrics.appended}` +
        `${metrics.appendSkipped ? ' (skipped: a row for this range end already exists)' : ''}.`,
    );
    return metrics;
};

module.exports = {
    TIMEZONE,
    getGameIdeasMetrics,
    getBugReportMetrics,
    runCommunityMetrics,
    runWeeklyCommunityMetrics,
    appendMetricsToSheet,
    ensureDataTab,
    hasRowForRangeEnd,
};
