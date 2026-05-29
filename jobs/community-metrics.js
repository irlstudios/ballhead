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

// Cap on archived-thread pagination so a historical query cannot loop unbounded.
const MAX_ARCHIVED_PAGES = 10;
const ARCHIVED_PAGE_SIZE = 100;

// All metrics are appended as one row per run into the existing "Data" tab.
const DATA_TAB = Object.freeze({
    title: 'Data',
    headers: [
        'Generated At', 'Range Start', 'Range End',
        'Game Ideas Threads', 'Game Ideas Messages', 'Unique Participants',
        'Bug Reports Total', 'Bug Reports Escalated', 'Bug Reports Un-escalated',
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

// Collects active + archived threads from a forum channel, paginating archived
// threads up to a safety cap. Returns the raw thread objects.
const collectForumThreads = async (forumChannel) => {
    const collected = new Map();

    const active = await forumChannel.threads.fetchActive();
    for (const thread of active.threads.values()) {
        collected.set(thread.id, thread);
    }

    let before;
    for (let page = 0; page < MAX_ARCHIVED_PAGES; page += 1) {
        const archived = await forumChannel.threads.fetchArchived({ limit: ARCHIVED_PAGE_SIZE, before });
        const threads = [...archived.threads.values()];
        for (const thread of threads) {
            collected.set(thread.id, thread);
        }
        if (!archived.hasMore || threads.length === 0) {
            break;
        }
        before = threads[threads.length - 1].id;
    }

    return [...collected.values()];
};

const getBugReportMetrics = async (client, start, end) => {
    const startMs = start.getTime();
    const endMs = end.getTime();

    const forumChannel = await client.channels.fetch(BUG_REPORTS_FORUM_CHANNEL_ID).catch(() => null);
    if (!forumChannel || typeof forumChannel.threads?.fetchActive !== 'function') {
        logger.error(`[CommunityMetrics] Bug reports forum '${BUG_REPORTS_FORUM_CHANNEL_ID}' not found or not a forum.`);
        return { total: 0, escalated: 0, unescalated: 0, threads: [], unavailable: true };
    }

    const allThreads = await collectForumThreads(forumChannel);

    const inRange = allThreads.filter((thread) => {
        const created = thread.createdTimestamp;
        return typeof created === 'number' && created >= startMs && created <= endMs;
    });

    const threads = inRange.map((thread) => {
        const appliedTags = Array.isArray(thread.appliedTags) ? thread.appliedTags : [];
        const escalated = appliedTags.includes(BUG_REPORT_ESCALATED_TAG_ID);
        return {
            id: thread.id,
            name: thread.name || '',
            url: thread.url || '',
            createdAt: thread.createdAt,
            escalated,
        };
    });

    const escalated = threads.filter((t) => t.escalated).length;
    return {
        total: threads.length,
        escalated,
        unescalated: threads.length - escalated,
        threads,
        unavailable: false,
    };
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

const appendMetricsToSheet = async (metrics) => {
    const sheets = await getSheetsClient();
    await ensureDataTab(sheets);

    const row = [
        formatTimestamp(new Date()),
        formatTimestamp(metrics.range.start),
        formatTimestamp(metrics.range.end),
        metrics.gameIdeas.threadCount,
        metrics.gameIdeas.messageCount,
        metrics.gameIdeas.uniqueParticipants,
        metrics.bugReports.total,
        metrics.bugReports.escalated,
        metrics.bugReports.unescalated,
    ];

    await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_COMMUNITY_METRICS,
        range: `${DATA_TAB.title}!A:I`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [row] },
    });
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
        bugReports = { total: 0, escalated: 0, unescalated: 0, threads: [], unavailable: true };
    }

    const metrics = { range: { start, end }, gameIdeas, bugReports, appended: false, appendError: null };

    if (appendSheet) {
        try {
            await appendMetricsToSheet(metrics);
            metrics.appended = true;
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
        `${metrics.gameIdeas.uniqueParticipants} participants. Bug reports: ${metrics.bugReports.escalated} escalated, ` +
        `${metrics.bugReports.unescalated} un-escalated. Appended: ${metrics.appended}.`,
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
};
