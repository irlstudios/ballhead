'use strict';

const moment = require('moment-timezone');
const logger = require('../utils/logger');
const { getSheetsClient } = require('../utils/sheets_cache');
const { getGameIdeasSummary, fetchGameIdeasThreadsInRange } = require('../db');
const {
    BUG_REPORTS_FORUM_CHANNEL_ID,
    BUG_REPORT_ESCALATED_TAG_ID,
    SPREADSHEET_COMMUNITY_METRICS,
} = require('../config/constants');

const TIMEZONE = 'America/Chicago';

// Cap on archived-thread pagination so a historical query cannot loop unbounded.
const MAX_ARCHIVED_PAGES = 10;
const ARCHIVED_PAGE_SIZE = 100;

const SHEET_TABS = Object.freeze({
    WEEKLY_SUMMARY: {
        title: 'Weekly Summary',
        headers: [
            'Generated At', 'Range Start', 'Range End',
            'Game Ideas Threads', 'Game Ideas Messages', 'Unique Participants',
            'Bug Reports Total', 'Bug Reports Escalated', 'Bug Reports Un-escalated',
        ],
    },
    GAME_IDEAS_THREADS: {
        title: 'Game Ideas Threads',
        headers: ['Generated At', 'Range Start', 'Range End', 'Thread Name', 'Starter ID', 'Created At', 'URL'],
    },
    BUG_REPORTS: {
        title: 'Bug Reports',
        headers: ['Generated At', 'Range Start', 'Range End', 'Thread Name', 'Escalated', 'Created At', 'URL'],
    },
});

const formatTimestamp = (value) => {
    if (!value) {
        return '';
    }
    const m = moment.tz(value, TIMEZONE);
    return m.isValid() ? m.format('YYYY-MM-DD HH:mm') : '';
};

const getGameIdeasMetrics = async (start, end) => {
    const summary = await getGameIdeasSummary(start, end);
    const threads = await fetchGameIdeasThreadsInRange(start, end);
    return { ...summary, threads };
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

const ensureSheetTabs = async (sheets) => {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_COMMUNITY_METRICS });
    const existingTitles = new Set((meta.data.sheets || []).map((s) => s.properties.title));

    const missing = Object.values(SHEET_TABS).filter((tab) => !existingTitles.has(tab.title));
    if (missing.length === 0) {
        return;
    }

    await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_COMMUNITY_METRICS,
        resource: {
            requests: missing.map((tab) => ({ addSheet: { properties: { title: tab.title } } })),
        },
    });

    for (const tab of missing) {
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_COMMUNITY_METRICS,
            range: `${tab.title}!A1`,
            valueInputOption: 'RAW',
            resource: { values: [tab.headers] },
        });
    }

    logger.info(`[CommunityMetrics] Created sheet tab(s): ${missing.map((t) => t.title).join(', ')}`);
};

const appendRows = async (sheets, tabTitle, rows) => {
    if (!rows || rows.length === 0) {
        return;
    }
    await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_COMMUNITY_METRICS,
        range: `${tabTitle}!A:Z`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: rows },
    });
};

const appendMetricsToSheet = async (metrics) => {
    const sheets = await getSheetsClient();
    await ensureSheetTabs(sheets);

    const generatedAt = formatTimestamp(new Date());
    const rangeStart = formatTimestamp(metrics.range.start);
    const rangeEnd = formatTimestamp(metrics.range.end);

    await appendRows(sheets, SHEET_TABS.WEEKLY_SUMMARY.title, [[
        generatedAt, rangeStart, rangeEnd,
        metrics.gameIdeas.threadCount,
        metrics.gameIdeas.messageCount,
        metrics.gameIdeas.uniqueParticipants,
        metrics.bugReports.total,
        metrics.bugReports.escalated,
        metrics.bugReports.unescalated,
    ]]);

    await appendRows(
        sheets,
        SHEET_TABS.GAME_IDEAS_THREADS.title,
        metrics.gameIdeas.threads.map((t) => [
            generatedAt, rangeStart, rangeEnd,
            t.name || '', t.starter_id || '', formatTimestamp(t.created_at), t.url || '',
        ]),
    );

    await appendRows(
        sheets,
        SHEET_TABS.BUG_REPORTS.title,
        metrics.bugReports.threads.map((t) => [
            generatedAt, rangeStart, rangeEnd,
            t.name || '', t.escalated ? 'Yes' : 'No', formatTimestamp(t.createdAt), t.url || '',
        ]),
    );
};

// Computes the full metrics set for a date range and optionally appends to the sheet.
const runCommunityMetrics = async (client, { start, end, appendSheet = false } = {}) => {
    const [gameIdeas, bugReports] = await Promise.all([
        getGameIdeasMetrics(start, end),
        getBugReportMetrics(client, start, end),
    ]);

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
    ensureSheetTabs,
};
