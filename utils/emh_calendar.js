'use strict';

// Pure layout for the EMH Monthly View tab: which dates sit in the grid, what
// each day cell says, and the Sheets updateCells payload. Kept free of the
// Sheets client so the exact text and colors are unit testable.

const moment = require('moment-timezone');
const { TIMEZONE, formatTime } = require('./emh_schedule');

// Title, weekday header, and up to six weeks. Always written in full so a
// five-week month clears whatever a six-week month left in the last row.
const GRID_ROWS = 8;
const GRID_COLUMNS = 7;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const STATUS_LABELS = { scheduled: 'Scheduled', hosted: 'Hosted', no_show: 'No-Show', cancelled: 'Cancelled' };
const STATUS_COLORS = {
    hosted: { red: 0.15, green: 0.5, blue: 0.15 },
    no_show: { red: 0.8, green: 0.1, blue: 0.1 },
    scheduled: { red: 0.75, green: 0.5, blue: 0 },
    cancelled: { red: 0.5, green: 0.5, blue: 0.5 },
};
const WHITE = { red: 1, green: 1, blue: 1 };
const OUTSIDE_MONTH = { red: 0.95, green: 0.95, blue: 0.95 };
const TITLE_FILL = { red: 0.29, green: 0.525, blue: 0.91 };
const HEADER_FILL = { red: 0.85, green: 0.85, blue: 0.85 };

const monthGrid = (now = new Date()) => {
    const first = moment.tz(now, TIMEZONE).startOf('month');
    const gridStart = first.clone().day(0);
    const gridEnd = first.clone().endOf('month').startOf('day').day(6);
    const weekCount = (gridEnd.diff(gridStart, 'days') + 1) / 7;
    const weeks = Array.from({ length: weekCount }, (_, week) => Array.from(
        { length: GRID_COLUMNS },
        (__, day) => gridStart.clone().add(week * 7 + day, 'days').format('YYYY-MM-DD')
    ));
    return {
        title: `EMH Monthly Calendar - ${first.format('MMMM YYYY')} (Central Time)`,
        month: first.format('YYYY-MM'),
        weeks,
        startInstant: gridStart.toDate(),
        endInstant: gridEnd.clone().add(1, 'day').toDate(),
    };
};

const localDate = (date) => moment.tz(date, TIMEZONE).format('YYYY-MM-DD');

const textCell = (text, format = {}) => ({
    userEnteredValue: { stringValue: text },
    userEnteredFormat: format,
});

// Each booking is two lines, "7PM - name" then "(Status)", colored together by
// one run that starts at the booking's first character.
const dayCell = (isoDate, bookings, inMonth) => {
    const dayNumber = String(Number(isoDate.slice(8, 10)));
    const entries = bookings
        .filter((booking) => localDate(booking.startsAt) === isoDate)
        .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))
        .map((booking) => ({
            text: `${formatTime(booking.startsAt)} - ${booking.hostUsername}\n(${STATUS_LABELS[booking.status]})`,
            color: STATUS_COLORS[booking.status],
        }));
    const { text, runs } = entries.reduce((acc, entry) => {
        const startIndex = acc.text.length + 1;
        return {
            text: `${acc.text}\n${entry.text}`,
            runs: [...acc.runs, { startIndex, format: { foregroundColorStyle: { rgbColor: entry.color } } }],
        };
    }, { text: dayNumber, runs: [] });
    return {
        userEnteredValue: { stringValue: text },
        textFormatRuns: runs,
        userEnteredFormat: {
            backgroundColor: inMonth ? WHITE : OUTSIDE_MONTH,
            wrapStrategy: 'WRAP',
            verticalAlignment: 'TOP',
        },
    };
};

const blankRow = () => ({ values: Array.from({ length: GRID_COLUMNS }, () => textCell('')) });

const buildMonthRows = (grid, bookings) => {
    const titleRow = {
        values: [
            textCell(grid.title, { backgroundColor: TITLE_FILL, textFormat: { bold: true, foregroundColor: WHITE } }),
            ...Array.from({ length: GRID_COLUMNS - 1 }, () => textCell('')),
        ],
    };
    const headerRow = { values: WEEKDAYS.map((day) => textCell(day, { backgroundColor: HEADER_FILL, textFormat: { bold: true } })) };
    const weekRows = grid.weeks.map((week) => ({
        values: week.map((iso) => dayCell(iso, bookings, iso.slice(0, 7) === grid.month)),
    }));
    const padding = Array.from({ length: GRID_ROWS - 2 - weekRows.length }, blankRow);
    return [titleRow, headerRow, ...weekRows, ...padding];
};

module.exports = { GRID_ROWS, GRID_COLUMNS, monthGrid, dayCell, buildMonthRows };
