'use strict';

// Pure metrics and formatting for host EMH sessions. No Discord and no database,
// so everything here is unit testable. The manager owns the side effects.

const SHEET_HEADER = [
    'Date',
    'Host',
    'Host ID',
    'Channel ID',
    'Activity',
    'Session Start',
    'Activity Start',
    'Session End',
    'Tracked Minutes',
    'Unique Joiners',
    'Peak Concurrent',
    'Total Joins',
    'Avg Play Time (min)',
    'Median Play Time (min)',
    'Total Player Minutes',
];

// Discord rejects channel names past 100 characters, so the host part is trimmed
// to fit rather than letting the rename fail at session start.
const EVENT_NAME_SUFFIX = '\'s EMH Session';
const MAX_CHANNEL_NAME = 100;

const eventChannelName = (displayName) => {
    const name = (displayName || '').trim() || 'Host';
    return `${name.slice(0, MAX_CHANNEL_NAME - EVENT_NAME_SUFFIX.length)}${EVENT_NAME_SUFFIX}`;
};

const toMinutes = (seconds) => Math.round(((Number(seconds) || 0) / 60) * 10) / 10;

const median = (values) => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

// The host is excluded from every participant metric. They are in the room for
// the whole session by definition, so counting them drags the average toward the
// session length and hides how long visitors actually stayed.
//
// Everyone else who entered the room counts, including someone who left again
// within a second: durations are floored to whole seconds, so gating on time
// would silently drop those visits from the joiner count.
const summariseSession = ({ members = [], hostId = null } = {}) => {
    const participants = members.filter((member) => member.userId !== hostId
        && ((Number(member.joinCount) || 0) > 0 || (Number(member.totalSeconds) || 0) > 0));
    const durations = participants.map((member) => Number(member.totalSeconds) || 0);
    const totalSeconds = durations.reduce((sum, seconds) => sum + seconds, 0);

    return {
        uniqueJoiners: participants.length,
        totalJoins: participants.reduce((sum, member) => sum + (Number(member.joinCount) || 0), 0),
        avgMinutes: participants.length === 0 ? 0 : toMinutes(totalSeconds / participants.length),
        medianMinutes: toMinutes(median(durations)),
        totalPlayerMinutes: toMinutes(totalSeconds),
    };
};

const isoOrBlank = (value) => {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
};

// Time under measurement, which starts when the activity does and not when the
// command runs: the gap between the two is setup, not session time.
const trackedMinutes = ({ activityStartedAt, endedAt }) => {
    if (!activityStartedAt || !endedAt) return 0;
    const start = new Date(activityStartedAt).getTime();
    const end = new Date(endedAt).getTime();
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0;
    return toMinutes((end - start) / 1000);
};

const buildSessionRow = ({ session = {}, summary = {} } = {}) => [
    isoOrBlank(session.endedAt).slice(0, 10),
    session.hostName || '',
    session.hostId || '',
    session.channelId || '',
    session.activityName || 'Unknown',
    isoOrBlank(session.startedAt),
    isoOrBlank(session.activityStartedAt),
    isoOrBlank(session.endedAt),
    trackedMinutes(session),
    summary.uniqueJoiners ?? 0,
    Number(session.peakConcurrent) || 0,
    summary.totalJoins ?? 0,
    summary.avgMinutes ?? 0,
    summary.medianMinutes ?? 0,
    summary.totalPlayerMinutes ?? 0,
];

const nudgeMessage = ({ guildId, channelId, hostId, activityName } = {}) => [
    `<@${hostId}> is hosting an EMH session${activityName ? ` playing **${activityName}**` : ''} right now.`,
    `Hop in the voice channel and play with us: https://discord.com/channels/${guildId}/${channelId}`,
].join('\n');

module.exports = {
    SHEET_HEADER,
    EVENT_NAME_SUFFIX,
    MAX_CHANNEL_NAME,
    eventChannelName,
    summariseSession,
    trackedMinutes,
    buildSessionRow,
    nudgeMessage,
    toMinutes,
    median,
};
