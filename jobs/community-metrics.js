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
// Game-ideas columns cover the date range; bug columns are a point-in-time
// snapshot of currently-open threads (plus one range-scoped open count).
const DATA_TAB = Object.freeze({
    title: 'Data',
    headers: [
        'Generated At', 'Range Start', 'Range End',
        'Game Ideas Threads', 'Game Ideas Messages', 'Unique Participants',
        'Bug Open In Range', 'Bug Total Open', 'Bug Open Escalated', 'Bug Open Un-escalated',
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

// "Open" = a currently-active (non-archived) thread that has not been closed via
// the forum's close button. Closing a post archives and locks it, and Discord
// also auto-archives inactive posts, so active+unlocked threads are exactly the
// ones shown as open in the forum. The unreliable "Closed" tag is ignored.
const getBugReportMetrics = async (client, start, end) => {
    const startMs = start.getTime();
    const endMs = end.getTime();

    const forumChannel = await client.channels.fetch(BUG_REPORTS_FORUM_CHANNEL_ID).catch(() => null);
    if (!forumChannel || typeof forumChannel.threads?.fetchActive !== 'function') {
        logger.error(`[CommunityMetrics] Bug reports forum '${BUG_REPORTS_FORUM_CHANNEL_ID}' not found or not a forum.`);
        return { totalOpen: 0, openEscalated: 0, openUnescalated: 0, openInRange: 0, unavailable: true };
    }

    const active = [...(await forumChannel.threads.fetchActive()).threads.values()];
    const open = active.filter((thread) => !thread.locked);

    const openEscalated = open.filter(isEscalatedThread).length;
    const openInRange = open.filter((thread) => {
        const created = thread.createdTimestamp;
        return typeof created === 'number' && created >= startMs && created <= endMs;
    }).length;

    return {
        totalOpen: open.length,
        openEscalated,
        openUnescalated: open.length - openEscalated,
        openInRange,
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
        range: `${DATA_TAB.title}!A1:J1`,
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
        metrics.bugReports.openInRange,
        metrics.bugReports.totalOpen,
        metrics.bugReports.openEscalated,
        metrics.bugReports.openUnescalated,
    ];

    await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_COMMUNITY_METRICS,
        range: `${DATA_TAB.title}!A:J`,
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
        bugReports = { totalOpen: 0, openEscalated: 0, openUnescalated: 0, openInRange: 0, unavailable: true };
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
        `${metrics.gameIdeas.uniqueParticipants} participants. Bug reports (open now): ${metrics.bugReports.totalOpen} total, ` +
        `${metrics.bugReports.openEscalated} escalated, ${metrics.bugReports.openUnescalated} un-escalated. Appended: ${metrics.appended}.`,
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
