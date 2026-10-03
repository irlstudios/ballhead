'use strict';

// Pure rules for EMH self-scheduling: the bookable week, time parsing, slot
// labels and the Hosted / No-Show decision. No Discord and no database, so all
// of it is unit testable; the command, job and queries own the side effects.

const moment = require('moment-timezone');

// Every cron in this bot runs on Chicago time and the hosts schedule on it.
const TIMEZONE = 'America/Chicago';
const LENGTH_CHOICES = [30, 60, 90, 120];
const DEFAULT_LENGTH = 60;
// A host who opens their room shortly before the slot still hosted it.
const EARLY_GRACE_MINUTES = 15;
const MINUTE_MS = 60 * 1000;

const TIME_PATTERN = /^\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*$/i;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LENGTH_LABELS = { 30: '30 min', 60: '1 hr', 90: '1.5 hr', 120: '2 hr' };

const local = (date) => moment.tz(date, TIMEZONE);

// day(0) is the Sunday of the current Sunday-to-Saturday week regardless of
// locale, so the bookable week never depends on moment's locale setting.
const weekBounds = (now = new Date()) => {
    const start = local(now).startOf('day').day(0);
    const end = start.clone().add(7, 'days');
    return {
        start: start.format('YYYY-MM-DD'),
        end: end.format('YYYY-MM-DD'),
        startInstant: start.toDate(),
        endInstant: end.toDate(),
    };
};

const bookableDays = (now = new Date()) => {
    const today = local(now).startOf('day');
    return Array.from({ length: 7 - today.day() }, (_, offset) => {
        const day = today.clone().add(offset, 'days');
        return { value: day.format('YYYY-MM-DD'), label: day.format('ddd M/D') };
    });
};

const parseTime = (text) => {
    const match = TIME_PATTERN.exec(String(text ?? ''));
    if (!match) return null;
    const hour12 = Number(match[1]);
    const minute = Number(match[2] || 0);
    if (hour12 < 1 || hour12 > 12 || minute > 59) return null;
    const pm = match[3].toLowerCase() === 'pm';
    return { hour: (hour12 % 12) + (pm ? 12 : 0), minute };
};

const reject = (reason) => ({ ok: false, reason });

const validateBooking = ({ day, time, lengthMinutes, now = new Date() }) => {
    const week = weekBounds(now);
    const validDay = DAY_PATTERN.test(String(day)) && moment.tz(day, 'YYYY-MM-DD', true, TIMEZONE).isValid();
    if (!validDay || day < week.start || day >= week.end) {
        return reject('That day is outside this week. You can only book Sunday through Saturday of the current week.');
    }
    const parsed = parseTime(time);
    if (!parsed) {
        return reject('I could not read that time. Use a format like 7PM or 7:30PM (Central time).');
    }
    if (!LENGTH_CHOICES.includes(lengthMinutes)) {
        return reject('Pick a length of 30, 60, 90 or 120 minutes.');
    }
    const start = moment.tz(day, 'YYYY-MM-DD', TIMEZONE).hour(parsed.hour).minute(parsed.minute);
    if (start.valueOf() <= new Date(now).getTime()) {
        return reject('That time has already passed. Pick a later time today or another day this week.');
    }
    return { ok: true, startsAt: start.toDate(), endsAt: start.clone().add(lengthMinutes, 'minutes').toDate() };
};

const formatTime = (date) => {
    const m = local(date);
    return m.minute() ? m.format('h:mmA') : m.format('hA');
};

const dayLabel = (date) => local(date).format('ddd M/D');
const lengthLabel = (minutes) => LENGTH_LABELS[minutes] || `${minutes} min`;
const slotMinutes = (booking) => Math.round((new Date(booking.endsAt) - new Date(booking.startsAt)) / MINUTE_MS);
const slotLabel = (booking) => `${dayLabel(booking.startsAt)} ${formatTime(booking.startsAt)} (${lengthLabel(slotMinutes(booking))})`;
const rangeLabel = (booking) => `${formatTime(booking.startsAt)}-${formatTime(booking.endsAt)}`;

// Overlap rather than start time, so one long session covers several
// consecutive slots. An open session counts up to now.
const resolveStatus = (booking, sessions, now = new Date()) => {
    const windowStart = new Date(booking.startsAt).getTime() - EARLY_GRACE_MINUTES * MINUTE_MS;
    const windowEnd = new Date(booking.endsAt).getTime();
    const hosted = sessions.some((session) => session.hostId === booking.hostId
        && new Date(session.startedAt).getTime() < windowEnd
        && new Date(session.endedAt || now).getTime() > windowStart);
    return hosted ? 'hosted' : 'no_show';
};

const isLead = (userId, leadIds, ownerId) => leadIds.includes(userId) || (Boolean(ownerId) && userId === ownerId);

module.exports = {
    TIMEZONE,
    LENGTH_CHOICES,
    DEFAULT_LENGTH,
    EARLY_GRACE_MINUTES,
    weekBounds,
    bookableDays,
    parseTime,
    validateBooking,
    formatTime,
    dayLabel,
    lengthLabel,
    slotMinutes,
    slotLabel,
    rangeLabel,
    resolveStatus,
    isLead,
};
