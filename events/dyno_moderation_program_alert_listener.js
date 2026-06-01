'use strict';

const { MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const logger = require('../utils/logger');
const { getProgramRoleSnapshot } = require('../db');
const {
    parseDynoModerationEmbed,
    extractEmbedData,
} = require('../utils/dyno_moderation_parser');
const {
    resolveProgramMatches,
    buildAlertText,
} = require('../utils/program_moderation_alert');
const {
    DYNO_BOT_ID,
    PROGRAM_LEADS,
    PROGRAM_MODERATION_ALERT_CHANNEL_ID,
} = require('../config/constants');

// In-memory guard against duplicate alerts within this runtime. Dyno can edit
// or repost a log, and messageCreate may fire more than once; we alert at most
// once per message id. Bounded so it cannot grow without limit.
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

// Find the first embed on the message that is a tracked Dyno moderation action.
const findModerationRecord = (message) => {
    const embeds = Array.isArray(message.embeds) ? message.embeds : [];
    for (const embed of embeds) {
        const record = parseDynoModerationEmbed(extractEmbedData(embed));
        if (record) {
            return record;
        }
    }
    return null;
};

// Resolve the role ids the moderated user holds (or held). Prefers a live
// member fetch; on failure (typically a ban where the member is gone) falls
// back to the durable program-role snapshot. Returns the role ids plus whether
// they came from history and whether resolution succeeded at all.
const resolveMemberRoleIds = async (guild, userId) => {
    try {
        const member = await guild.members.fetch(userId);
        return { roleIds: [...member.roles.cache.keys()], historical: false, resolved: true };
    } catch (fetchError) {
        logger.info(`[DynoModAlert] Member ${userId} not in guild (${fetchError.message}); trying snapshot.`);
        try {
            const snapshot = await getProgramRoleSnapshot(userId);
            if (snapshot) {
                return { roleIds: snapshot.roleIds, historical: true, resolved: true };
            }
        } catch (snapshotError) {
            logger.error(`[DynoModAlert] Snapshot lookup failed for ${userId}:`, snapshotError);
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

module.exports = {
    name: 'messageCreate',
    once: false,
    async execute(message) {
        try {
            if (message.author?.id !== DYNO_BOT_ID) {
                return;
            }
            if (!Array.isArray(message.embeds) || message.embeds.length === 0) {
                return;
            }

            const record = findModerationRecord(message);
            if (!record) {
                return;
            }

            if (!markProcessed(message.id)) {
                return;
            }

            const guild = message.guild;
            if (!guild) {
                logger.info('[DynoModAlert] Moderation log had no guild context; skipping.');
                return;
            }

            if (!record.userId) {
                logger.info(
                    `[DynoModAlert] Case ${record.caseNumber} (${record.action}) for "${record.targetName}" ` +
                    'has no resolvable user id (no mention or footer ID); cannot check program roles.'
                );
                return;
            }

            const { roleIds, historical, resolved } = await resolveMemberRoleIds(guild, record.userId);

            if (!resolved) {
                logger.info(
                    `[DynoModAlert] Case ${record.caseNumber} (${record.action}): member ${record.userId} ` +
                    'is gone and no role snapshot exists; historical program roles are unavailable.'
                );
                return;
            }

            const matches = resolveProgramMatches(roleIds, PROGRAM_LEADS);
            if (matches.length === 0) {
                logger.info(
                    `[DynoModAlert] Case ${record.caseNumber} (${record.action}) for ${record.userId}: ` +
                    'not a program member; no alert sent.'
                );
                return;
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
            });

            let channel;
            try {
                channel = await guild.channels.fetch(PROGRAM_MODERATION_ALERT_CHANNEL_ID);
            } catch (channelError) {
                logger.error(`[DynoModAlert] Could not fetch alert channel: ${channelError.message}`);
                return;
            }

            // Ping the relevant lead(s) in a plain-content message so they get a
            // real notification. Components V2 messages cannot carry `content`,
            // and a mention buried in the card is easy to miss, so the ping is
            // sent as its own message just above the detail card. Lead ids are
            // user ids; every program the member belongs to gets its lead pinged.
            const leadMentions = leadIds.map((leadId) => `<@${leadId}>`).join(' ');
            await channel.send({
                content: `${leadMentions} a program member just received a moderation action.`,
                allowedMentions: { users: leadIds, parse: [] },
            });

            const container = new ContainerBuilder();
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));

            // parse: [] so the moderator/target mentions inside the card render
            // without pinging anyone (only the lead, pinged above, is notified).
            await channel.send({
                flags: MessageFlags.IsComponentsV2,
                components: [container],
                allowedMentions: { parse: [] },
            });

            logger.info(
                `[DynoModAlert] Alerted lead(s) ${leadIds.join(', ')}: program member ${record.userId} ` +
                `received ${record.action} (case ${record.caseNumber}).`
            );
        } catch (error) {
            logger.error('[DynoModAlert] Failed to process Dyno moderation log:', error);
        }
    },
};
