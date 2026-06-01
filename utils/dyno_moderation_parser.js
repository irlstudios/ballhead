'use strict';

// Pure parsing for Dyno moderation log embeds.
//
// Dyno posts one embed per moderation action with a title shaped like
//   "Case 20244 | Mute | bob1102976"
// and fields such as User, Moderator, Length, Reason. The target user id is
// usually a mention inside the User field, but on bans the field may only hold
// a display name, in which case Dyno includes "ID: <digits>" in the footer.
//
// Everything here is side-effect free so it can be unit tested without a
// Discord client or database.

const MODERATION_ACTIONS = ['Mute', 'Warn', 'Ban'];

const TITLE_PATTERN = /^Case\s+(\d+)\s*\|\s*([A-Za-z]+)\s*\|\s*(.+)$/i;
const MENTION_PATTERN = /<@!?(\d+)>/;
const FOOTER_ID_PATTERN = /ID:\s*(\d+)/i;

// Canonical action label (e.g. "mute" -> "Mute"); null if not a tracked action.
const canonicalAction = (raw) => {
    const match = MODERATION_ACTIONS.find(
        (action) => action.toLowerCase() === raw.toLowerCase()
    );
    return match || null;
};

// Build a lookup of trimmed, lower-cased field name -> value.
const indexFields = (fields) => {
    const list = Array.isArray(fields) ? fields : [];
    return list.reduce((acc, field) => {
        if (!field || typeof field.name !== 'string') {
            return acc;
        }
        return { ...acc, [field.name.trim().toLowerCase()]: field.value };
    }, {});
};

const firstMatch = (pattern, ...texts) => {
    for (const text of texts) {
        if (typeof text !== 'string') {
            continue;
        }
        const match = text.match(pattern);
        if (match) {
            return match[1];
        }
    }
    return null;
};

// Normalise a discord.js Embed into the plain shape the parser expects.
// Dyno carries the "Case N | Action | name" line in the embed author name
// (title is null), so authorName is captured alongside title.
const extractEmbedData = (embed) => {
    if (!embed) {
        return { title: null, authorName: null, description: null, fields: [], footerText: null };
    }
    const fields = Array.isArray(embed.fields)
        ? embed.fields.map((field) => ({ name: field.name, value: field.value }))
        : [];
    return {
        title: embed.title ?? null,
        authorName: embed.author?.name ?? null,
        description: embed.description ?? null,
        fields,
        footerText: embed.footer?.text ?? null,
    };
};

// Parse a normalised embed into a moderation record, or null when the embed is
// not a tracked Dyno moderation action.
const parseDynoModerationEmbed = (embed) => {
    if (!embed) {
        return null;
    }

    // The case line lives in the title or, for real Dyno embeds, the author name.
    const caseLine = [embed.title, embed.authorName].find(
        (text) => typeof text === 'string' && TITLE_PATTERN.test(text)
    );
    if (!caseLine) {
        return null;
    }

    const titleMatch = caseLine.match(TITLE_PATTERN);

    const action = canonicalAction(titleMatch[2]);
    if (!action) {
        return null;
    }

    const fields = indexFields(embed.fields);
    const userField = fields.user;

    const mentionId = typeof userField === 'string'
        ? firstMatch(MENTION_PATTERN, userField)
        : null;
    const userId = mentionId
        || firstMatch(FOOTER_ID_PATTERN, embed.footerText, embed.description);

    return {
        caseNumber: titleMatch[1],
        action,
        targetName: titleMatch[3].trim(),
        userId: userId || null,
        moderator: fields.moderator ?? null,
        length: fields.length ?? null,
        reason: fields.reason ?? null,
    };
};

module.exports = {
    MODERATION_ACTIONS,
    extractEmbedData,
    parseDynoModerationEmbed,
};
