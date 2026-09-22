'use strict';

// Pure cycle maths and post text for the Top Event Winner race. No Discord and
// no database, so all of it is unit testable; jobs/event-winner-cycle.js owns
// the side effects.
//
// A cycle is 14 days counted from a fixed anchor, so "bi-weekly" is a calendar
// both the leads and the members can predict rather than a side effect of when
// the job last happened to run.

const moment = require('moment-timezone');
const { EVENT_WINNER_CYCLE_ANCHOR } = require('../config/constants');

// Every cron in this bot runs on Chicago time and the community plays on it, so
// a cycle day is a Chicago day. On UTC days a Sunday evening event would land
// past midnight UTC and be counted toward the next fortnight, which takes prime
// time off the end of every cycle.
const TIMEZONE = 'America/Chicago';

const DAY_MS = 24 * 60 * 60 * 1000;
const CYCLE_DAYS = 14;
const MEDALS = ['1st', '2nd', '3rd'];
const TOP_LISTED = 10;

// Cycle arithmetic runs on UTC-midnight stamps of the calendar date, which
// keeps the 14-day steps free of daylight saving; only the conversion to a real
// instant, in dayStartInstant, is timezone aware.
const parseDayUTC = (iso) => Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);
const toISODate = (ms) => new Date(ms).toISOString().slice(0, 10);

// Today as the community sees it, which is what the daily job must compare
// against a cycle boundary.
const todayLocal = () => moment.tz(TIMEZONE).format('YYYY-MM-DD');

// The instant a cycle boundary actually falls on, for querying sessions.
const dayStartInstant = (iso) => moment.tz(String(iso).slice(0, 10), 'YYYY-MM-DD', TIMEZONE).toDate().toISOString();

// The window that has fully closed as of `todayISO`. Derived from the anchor
// rather than from the last run, so a job that misses its day announces the
// same cycle late instead of announcing a shifted one or skipping it.
const completedCycle = (todayISO, anchorISO = EVENT_WINNER_CYCLE_ANCHOR) => {
    const anchor = parseDayUTC(anchorISO);
    const today = parseDayUTC(todayISO);
    if (Number.isNaN(anchor) || Number.isNaN(today)) return null;
    const elapsed = Math.floor((today - anchor) / DAY_MS);
    if (elapsed < CYCLE_DAYS) return null;
    // ponytail: only the most recent closed cycle is returned, so a bot down for
    // a full fortnight skips one rather than back-filling it. Iterate unclaimed
    // cycles here if that outage ever actually happens.
    const currentStart = anchor + Math.floor(elapsed / CYCLE_DAYS) * CYCLE_DAYS * DAY_MS;
    return { start: toISODate(currentStart - CYCLE_DAYS * DAY_MS), end: toISODate(currentStart) };
};

// End is exclusive, so the label names the last day actually inside the window
// rather than the first day of the next one.
const cycleLabel = ({ start, end }) => `${start} to ${toISODate(parseDayUTC(end) - DAY_MS)}`;

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

const standingLine = (standing, index) => {
    const place = MEDALS[index] || `${index + 1}th`;
    return `**${place}:** <@${standing.userId}> - ${plural(standing.wins, 'win')}`;
};

// Announcement for a closed cycle. The role line is stated rather than implied:
// a member reading this should know what the top spot is actually worth.
const announcementText = ({ standings = [], cycle, roleId = '' } = {}) => {
    if (standings.length === 0) return null;
    const [champion] = standings;
    const tied = standings.filter((standing) => standing.wins === champion.wins).length > 1;
    return [
        `## Top Event Winner: ${cycleLabel(cycle)}`,
        '',
        `<@${champion.userId}> takes it with ${plural(champion.wins, 'event win')}.`,
        roleId ? `They hold <@&${roleId}> until the next cycle closes.` : null,
        tied ? 'Tied on wins, decided by who got there first.' : null,
        '',
        ...standings.slice(0, TOP_LISTED).map(standingLine),
        '',
        'Win an EMH session to get on the board. Hosts record the winner with `/room event winner`.',
    // Only the conditional lines drop out; the empty strings are deliberate
    // blank lines and have to survive.
    ].filter((line) => line !== null).join('\n');
};

module.exports = {
    DAY_MS,
    CYCLE_DAYS,
    TOP_LISTED,
    TIMEZONE,
    todayLocal,
    dayStartInstant,
    completedCycle,
    cycleLabel,
    announcementText,
};
