'use strict';

// One-off reader for the hand-typed Monthly View grid, used only by
// scripts/import_emh_monthly_view.js. It accepts noise that has one obvious
// reading and flags anything that would need a guess, so Roy decides every
// ambiguous line through the overrides file instead of the parser inventing it.

const moment = require('moment-timezone');
const { TIMEZONE, parseTime } = require('./emh_schedule');

const FIRST_WEEK_ROW = 2;
const DEFAULT_IMPORT_MINUTES = 60;
const MINUTE_MS = 60 * 1000;
const ENTRY = /(\d{1,2}(?::\d{2})?)\s*(am|pm)?\s*-\s*([^\s()]+)\s*\(+\s*(hosted|no-show|scheduled|cancelled)\s*\)+/gi;
const STATUSES = { hosted: 'hosted', 'no-show': 'no_show', scheduled: 'scheduled', cancelled: 'cancelled' };
const MONTH_IN_TITLE = /([A-Z][a-z]+) (\d{4})/;

const usernameIdsFromRequirementCheck = (values) => Object.fromEntries(values
    .slice(1)
    .filter((row) => row?.[0] && /^\d{15,}$/.test(String(row[1] || '')))
    .map((row) => [String(row[0]).trim().toLowerCase(), String(row[1]).trim()]));

const gridStartFromTitle = (title) => {
    const match = MONTH_IN_TITLE.exec(String(title || ''));
    if (!match) throw new Error(`Cannot read the month from the title: ${title}`);
    return moment.tz(`${match[1]} ${match[2]}`, 'MMMM YYYY', TIMEZONE).startOf('month').day(0);
};

const toInstant = (isoDate, timeText) => {
    const parsed = parseTime(timeText);
    return parsed ? moment.tz(isoDate, 'YYYY-MM-DD', TIMEZONE).hour(parsed.hour).minute(parsed.minute).toDate() : null;
};

// An override is either a time ("9:45PM") or a date and time ("2026-08-31 12AM").
const applyOverride = (isoDate, override) => {
    const [maybeDate, maybeTime] = String(override).split(' ');
    return maybeTime ? toInstant(maybeDate, maybeTime) : toInstant(isoDate, maybeDate);
};

const parseCell = ({ raw, isoDate, usernameIds, overrides }) => {
    const text = String(raw ?? '').replace(/\r/g, '');
    const flag = (reason, detail) => ({ date: isoDate, text: detail, reason });
    const typedDay = /^\s*(\d{1,2})/.exec(text);
    const dayFlags = typedDay && Number(typedDay[1]) !== Number(isoDate.slice(8, 10))
        ? [flag('day-mismatch', text.split('\n')[0])]
        : [];
    const body = text.replace(/^\s*\d{1,2}\s*/, '');
    const matches = [...body.matchAll(ENTRY)];
    const leftover = matches.reduce((rest, m) => rest.replace(m[0], ''), body).trim();
    const leftoverFlags = leftover ? [flag('unparsed', leftover)] : [];

    const parsed = matches.map((m) => {
        const rawTime = `${m[1]}${m[2] ? m[2].toUpperCase() : ''}`;
        const username = m[3].trim().toLowerCase();
        const key = `${isoDate}|${rawTime}|${username}`;
        const overrideTime = overrides.times?.[key];
        return {
            key,
            rawTime,
            username,
            status: STATUSES[m[4].toLowerCase()],
            hostId: overrides.usernames?.[username] || usernameIds[username] || null,
            startsAt: overrideTime ? applyOverride(isoDate, overrideTime) : toInstant(isoDate, rawTime),
            overridden: Boolean(overrideTime),
            skipped: (overrides.skip || []).includes(key),
        };
    }).filter((entry) => !entry.skipped);

    const results = parsed.map((entry, index) => {
        const previous = parsed[index - 1];
        if (!entry.startsAt) return { flag: flag('no-ampm', entry.key) };
        if (!entry.overridden && previous?.startsAt && entry.startsAt < previous.startsAt) {
            return { flag: flag('out-of-order', entry.key) };
        }
        if (!entry.hostId) return { flag: flag('unknown-user', entry.key) };
        return { entry };
    });
    return {
        entries: results.filter((r) => r.entry).map((r) => ({ ...r.entry, date: isoDate })),
        flags: [...dayFlags, ...leftoverFlags, ...results.filter((r) => r.flag).map((r) => r.flag)],
    };
};

// One hour, or less when the old calendar had the next slot sooner, so legacy
// data never trips the overlap constraint.
const withLengths = (entries) => {
    const sorted = [...entries].sort((a, b) => a.startsAt - b.startsAt);
    return sorted.map((entry, index) => {
        const hourLater = entry.startsAt.getTime() + DEFAULT_IMPORT_MINUTES * MINUTE_MS;
        const next = sorted[index + 1]?.startsAt.getTime();
        return { ...entry, endsAt: new Date(next && next < hourLater ? next : hourLater) };
    });
};

const parseMonthlyView = (values, { usernameIds, overrides = {} }) => {
    const gridStart = gridStartFromTitle(values[0]?.[0]);
    const cells = values.slice(FIRST_WEEK_ROW).flatMap((row, week) => (row || []).map((raw, day) => ({
        raw,
        isoDate: gridStart.clone().add(week * 7 + day, 'days').format('YYYY-MM-DD'),
    })));
    const parsed = cells.map((cell) => parseCell({ ...cell, usernameIds, overrides }));
    const entries = withLengths(parsed.flatMap((p) => p.entries)).map((entry) => ({
        date: entry.date,
        rawTime: entry.rawTime,
        username: entry.username,
        hostId: entry.hostId,
        status: entry.status,
        // Roy's own Hosted / No-Show / Cancelled calls stand; only slots still
        // marked Scheduled are left for the resolver to decide.
        statusSource: entry.status === 'scheduled' ? 'auto' : 'manual',
        startsAt: entry.startsAt,
        endsAt: entry.endsAt,
    }));
    return { entries, flags: parsed.flatMap((p) => p.flags) };
};

module.exports = { parseMonthlyView, usernameIdsFromRequirementCheck };
