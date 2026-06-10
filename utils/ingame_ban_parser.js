'use strict';

// Pure parsing for the in-game ban bot's moderation messages.
//
// Unlike Dyno (which posts embeds), this bot posts a single plain-text line:
//   "ASH CASH ZAY (and discord <@1473500368418640044>) has been banned for
//    14.0 days by revroy for the following reasons: bullying"
// Permanent bans read "... has been banned permanently by <mod> ...", and when
// the banned player has no linked Discord the mention is empty: "(and discord
// <@>)" -> userId is null and the caller ignores it.
//
// Side-effect free so it can be unit tested without a Discord client.

// Anchored end-to-end so a partial/unrelated message cannot match. Groups:
//   target    in-game name (may contain spaces, parentheses, symbols)
//   id        discord user id digits, or empty for an unlinked player
//   duration  "for 14.0 days" or "permanently"
//   moderator the staff member who issued the ban
//   reason    free-text reason (rest of the line)
const BAN_PATTERN = new RegExp(
    '^(?<target>.+?)\\s+\\(and discord <@!?(?<id>\\d*)>\\)\\s+' +
    'has been banned\\s+(?<duration>.+?)\\s+by\\s+(?<moderator>.+?)\\s+' +
    'for the following reasons:\\s*(?<reason>.*)$'
);

// Turn the raw duration clause into a human-readable length.
// "for 14.0 days" -> "14.0 days"; "permanently" -> "permanent".
const normaliseLength = (duration) => {
    const trimmed = duration.trim();
    if (/^permanent(ly)?$/i.test(trimmed)) {
        return 'permanent';
    }
    const forMatch = trimmed.match(/^for\s+(.+)$/i);
    return forMatch ? forMatch[1].trim() : trimmed;
};

// Parse a ban message into a moderation record, or null when the text is not a
// ban announcement. A record with userId === null means the banned player had
// no linked Discord account (the caller skips those).
const parseInGameBanMessage = (content) => {
    if (typeof content !== 'string') {
        return null;
    }

    const match = content.trim().match(BAN_PATTERN);
    if (!match) {
        return null;
    }

    const { target, id, duration, moderator, reason } = match.groups;

    return {
        action: 'Ban',
        targetName: target.trim(),
        userId: id ? id : null,
        moderator: moderator.trim() || null,
        length: normaliseLength(duration),
        reason: reason.trim() || null,
    };
};

module.exports = {
    parseInGameBanMessage,
};
