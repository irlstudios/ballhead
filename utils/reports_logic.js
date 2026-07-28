'use strict';

// Pure logic for player reports: what counts as proof, how urgent a report is,
// and how a report reads. No Discord and no database, so it is all unit testable.

// Reporter-declared severity. The weight is the largest single input to the
// priority score, which is deliberate: a slur report should outrank a week-old
// griefing report. Reporters inflate this, so treat it as a sort hint rather
// than a claim about what happened.
const SEVERITIES = [
    { value: 'hate', label: 'Hate speech or slurs', weight: 35 },
    { value: 'harassment', label: 'Harassment or threats', weight: 30 },
    { value: 'cheating', label: 'Cheating or exploiting', weight: 20 },
    { value: 'griefing', label: 'Griefing or trolling', weight: 10 },
    { value: 'other', label: 'Other', weight: 5 },
];

const SEVERITY_BY_VALUE = Object.fromEntries(SEVERITIES.map((s) => [s.value, s]));

const severityLabel = (value) => SEVERITY_BY_VALUE[value]?.label || 'Other';
const severityWeight = (value) => SEVERITY_BY_VALUE[value]?.weight ?? SEVERITY_BY_VALUE.other.weight;

const STATUS_LABEL = {
    open: 'Open',
    approved: 'Approved',
    denied: 'Denied',
    needs_info: 'Needs info',
};

// Enough that "he cheated" does not pass, short enough that a real one-line
// description of a clip does.
const MIN_DESCRIPTION_LENGTH = 15;

const PROOF_ERRORS = {
    missing: 'Attach a screenshot or video, or paste a link to one. A report without proof cannot be reviewed.',
    'bad-attachment': 'The attached file is not an image or video. Attach a screenshot or clip, or paste a link to one instead.',
    'bad-link': 'The proof link is not a valid http(s) URL. Paste the full link, for example https://medal.tv/clips/...',
    'short-description': `Describe what the proof shows and when it happens (at least ${MIN_DESCRIPTION_LENGTH} characters).`,
};

const isMediaAttachment = (attachment) => {
    const type = (attachment && attachment.contentType) || '';
    return type.startsWith('image/') || type.startsWith('video/');
};

const normaliseLink = (link) => {
    const raw = (link || '').trim();
    if (!raw) {
        return null;
    }
    try {
        const url = new URL(raw);
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : false;
    } catch {
        return false;
    }
};

// Discord cannot express "one of these two options is required", so both proof
// sources are optional on the command and this is the real gate. Returns the
// normalised link so the caller stores a canonical URL rather than raw input.
const validateReportProof = ({ attachment = null, link = null, description = '' } = {}) => {
    const trimmedDescription = (description || '').trim();
    if (trimmedDescription.length < MIN_DESCRIPTION_LENGTH) {
        return { ok: false, reason: 'short-description', link: null, description: trimmedDescription };
    }

    const normalisedLink = normaliseLink(link);
    if (normalisedLink === false) {
        return { ok: false, reason: 'bad-link', link: null, description: trimmedDescription };
    }

    if (attachment && !isMediaAttachment(attachment)) {
        return { ok: false, reason: 'bad-attachment', link: null, description: trimmedDescription };
    }

    if (!attachment && !normalisedLink) {
        return { ok: false, reason: 'missing', link: null, description: trimmedDescription };
    }

    return { ok: true, reason: null, link: normalisedLink, description: trimmedDescription };
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const HOUR_MS = 3600000;

// Four signals, weighted so that no single one can dominate: what the reporter
// says it is, how many other people are waiting on the same player, whether this
// reporter has been right before, and how long it has sat. The caps matter more
// than the coefficients - without them one player with twenty reports would bury
// every other case in the queue.
// ponytail: fixed weights, tune the numbers if the queue starts feeling wrong.
const scoreReport = (row, now = Date.now()) => {
    const severity = severityWeight(row.severity);
    const repeat = clamp(8 * (Number(row.other_open_count) || 0), 0, 40);
    const record = clamp((Number(row.reporter_approved) || 0) - (Number(row.reporter_denied) || 0), -15, 15);
    const createdAt = row.created_at ? new Date(row.created_at).getTime() : now;
    const ageHours = Math.max(0, (now - createdAt) / HOUR_MS);
    const age = clamp(ageHours / 6, 0, 30);
    return severity + repeat + record + age;
};

// Highest score first, oldest first on a tie so nothing can starve at the bottom.
const sortByPriority = (rows, now = Date.now()) => [...rows]
    .map((row) => ({ row, score: scoreReport(row, now) }))
    .sort((a, b) => {
        if (b.score !== a.score) {
            return b.score - a.score;
        }
        return new Date(a.row.created_at || 0) - new Date(b.row.created_at || 0);
    })
    .map((entry) => ({ ...entry.row, score: entry.score }));

const formatAge = (createdAt, now = Date.now()) => {
    const started = createdAt ? new Date(createdAt).getTime() : now;
    const hours = Math.max(0, (now - started) / HOUR_MS);
    if (hours < 1) {
        return 'under an hour';
    }
    if (hours < 48) {
        return `${Math.floor(hours)}h`;
    }
    return `${Math.floor(hours / 24)}d`;
};

module.exports = {
    SEVERITIES,
    STATUS_LABEL,
    PROOF_ERRORS,
    MIN_DESCRIPTION_LENGTH,
    severityLabel,
    severityWeight,
    validateReportProof,
    scoreReport,
    sortByPriority,
    formatAge,
};
