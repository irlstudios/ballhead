'use strict';

const { MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const logger = require('./logger');
const { getProgramRoleSnapshot } = require('../db');
const { resolveProgramMatches, buildAlertText } = require('./program_moderation_alert');
const {
    PROGRAM_LEADS,
    PROGRAM_MODERATION_ALERT_CHANNEL_ID,
} = require('../config/constants');

// In-memory guard against duplicate alerts within this runtime. A source bot
// can edit or repost a log, and the gateway can deliver an event more than
// once; we alert at most once per message id. Bounded so it cannot grow
// without limit. Shared across every moderation source (message ids are unique
// across channels, so one guard is enough).
const MAX_TRACKED_MESSAGE_IDS = 5000;
const processedMessageIds = new Set();

const markProcessed = (messageId) => {
    if (processedMessageIds.has(messageId)) {
        return false;
    }
    if (processedMessageIds.size >= MAX_TRACKED_MESSAGE_IDS) {
        const oldest = processedMessageIds.values().next().value;
        processedMessageIds.delete(oldest);
    }
    processedMessageIds.add(messageId);
    return true;
};

// Resolve the role ids the moderated user holds (or held). Prefers a live
// member fetch; on failure (typically a ban where the member is gone) falls
// back to the durable program-role snapshot. Returns the role ids plus whether
// they came from history and whether resolution succeeded at all.
const resolveMemberRoleIds = async (guild, userId, source) => {
    try {
        const member = await guild.members.fetch(userId);
        return { roleIds: [...member.roles.cache.keys()], historical: false, resolved: true };
    } catch (fetchError) {
        logger.info(`[${source}] Member ${userId} not in guild (${fetchError.message}); trying snapshot.`);
        try {
            const snapshot = await getProgramRoleSnapshot(userId);
            if (snapshot) {
                return { roleIds: snapshot.roleIds, historical: true, resolved: true };
            }
        } catch (snapshotError) {
            logger.error(`[${source}] Snapshot lookup failed for ${userId}:`, snapshotError);
        }
        return { roleIds: [], historical: true, resolved: false };
    }
};

// Map role ids to human-friendly labels (role name when cached, else the id).
const labelRoles = (guild, roleIds) =>
    roleIds.map((roleId) => {
        const role = guild.roles.cache.get(roleId);
        return role ? role.name : `\`${roleId}\``;
    });

// Given a parsed moderation record and the message it came from, alert the
// relevant program lead(s) if the moderated user is a program member. Shared by
// every moderation source (Dyno embeds, in-game ban announcements). `source` is
// a short log prefix; `logLabel` names the jump link in the alert body.
//
// Returns true when an alert was sent, false otherwise (not a member, no
// resolvable user, duplicate, etc.). All branches are logged.
const dispatchProgramModerationAlert = async ({ message, record, source, logLabel, origin }) => {
    if (!markProcessed(message.id)) {
        return false;
    }

    const guild = message.guild;
    if (!guild) {
        logger.info(`[${source}] Moderation log had no guild context; skipping.`);
        return false;
    }

    if (!record.userId) {
        logger.info(
            `[${source}] ${record.action} for "${record.targetName}" has no resolvable ` +
            'discord id; cannot check program roles.'
        );
        return false;
    }

    const { roleIds, historical, resolved } = await resolveMemberRoleIds(guild, record.userId, source);
    if (!resolved) {
        logger.info(
            `[${source}] ${record.action} for ${record.userId}: member is gone and no role ` +
            'snapshot exists; historical program roles are unavailable.'
        );
        return false;
    }

    const matches = resolveProgramMatches(roleIds, PROGRAM_LEADS);
    if (matches.length === 0) {
        logger.info(
            `[${source}] ${record.action} for ${record.userId}: not a program member; no alert sent.`
        );
        return false;
    }

    const leadIds = [...new Set(matches.map((match) => match.leadId))];
    const matchedRoleIds = [...new Set(matches.flatMap((match) => match.roleIds))];
    const matchedRoleLabels = labelRoles(guild, matchedRoleIds);
    const body = buildAlertText({
        action: record.action,
        userId: record.userId,
        targetName: record.targetName,
        moderator: record.moderator,
        length: record.length,
        reason: record.reason,
        matchedRoleLabels,
        messageUrl: message.url,
        rolesHistorical: historical,
        logLabel,
        origin,
    });

    let channel;
    try {
        channel = await guild.channels.fetch(PROGRAM_MODERATION_ALERT_CHANNEL_ID);
    } catch (channelError) {
        logger.error(`[${source}] Could not fetch alert channel: ${channelError.message}`);
        return false;
    }

    // Ping the relevant lead(s) in a plain-content message so they get a real
    // notification. Components V2 messages cannot carry `content`, and a mention
    // buried in the card is easy to miss, so the ping is its own message just
    // above the detail card. Every program the member belongs to pings its lead.
    const leadMentions = leadIds.map((leadId) => `<@${leadId}>`).join(' ');
    const originSuffix = origin ? ` (${origin})` : '';
    await channel.send({
        content: `${leadMentions} a program member just received a moderation action${originSuffix}.`,
        allowedMentions: { users: leadIds, parse: [] },
    });

    const container = new ContainerBuilder();
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));

    // parse: [] so the moderator/target mentions inside the card render without
    // pinging anyone (only the lead, pinged above, is notified).
    await channel.send({
        flags: MessageFlags.IsComponentsV2,
        components: [container],
        allowedMentions: { parse: [] },
    });

    logger.info(
        `[${source}] Alerted lead(s) ${leadIds.join(', ')}: program member ${record.userId} ` +
        `received ${record.action}.`
    );
    return true;
};

module.exports = {
    markProcessed,
    resolveMemberRoleIds,
    labelRoles,
    dispatchProgramModerationAlert,
};
