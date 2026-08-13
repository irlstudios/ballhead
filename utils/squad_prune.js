'use strict';

// Squad membership cleanup (daily 11:59PM CT cron + /squad prune). The
// criterion is purely "not in the guild anymore": squads whose owner left
// are disbanded; departed members are pruned from surviving squads.
// Rewritten onto Postgres 2026-08 (was three-sheet surgery under an
// in-process lock).

const { MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const { GYM_CLASS_GUILD_ID, LOGGING_CHANNEL_ID } = require('../config/constants');
const squadDb = require('./squad_db');
const { teardownDisbandedSquads } = require('../commands/squads/squad_disband');
const { buildTextBlock } = require('./ui');
const logger = require('./logger');

// Pure: decide the cleanup work from a snapshot.
function planSquadCleanup({ squads, membersBySquadId, guildMemberIds }) {
    const disband = [];
    const prune = [];
    for (const squad of squads) {
        if (!guildMemberIds.has(String(squad.owner_id))) {
            disband.push(squad);
            continue;
        }
        for (const member of membersBySquadId[squad.id] || []) {
            if (!guildMemberIds.has(String(member.user_id))) {
                prune.push({ squad, member });
            }
        }
    }
    return { disband, prune };
}

// Prune one squad's departed members. Returns the removed member rows.
async function pruneSquad(guild, guildMemberIds, squad) {
    const members = await squadDb.fetchSquadMembers(squad.id);
    const departed = members.filter((m) => !guildMemberIds.has(String(m.user_id)));
    const pruned = [];
    for (const member of departed) {
        const removed = await squadDb.removeSquadMember(squad.id, member.user_id);
        if (removed) {
            pruned.push({ user_id: member.user_id, username: member.username || member.user_id });
        }
    }
    return pruned;
}

async function pruneInactiveMembers(client) {
    logger.info('[Squad Prune] Starting squad membership cleanup...');

    const guild = await client.guilds.fetch(GYM_CLASS_GUILD_ID);
    const allGuildMembers = await guild.members.fetch();
    const guildMemberIds = new Set(allGuildMembers.keys());

    const squads = await squadDb.fetchAllSquadsWithCounts();
    const membersBySquadId = {};
    for (const squad of squads) {
        membersBySquadId[squad.id] = await squadDb.fetchSquadMembers(squad.id);
    }

    const plan = planSquadCleanup({ squads, membersBySquadId, guildMemberIds });

    const disbandedNames = [];
    for (const squad of plan.disband) {
        try {
            const result = await squadDb.disbandSquad(squad.id);
            if (!result) continue;
            disbandedNames.push(squad.name);
            await teardownDisbandedSquads(client, guild, [result]);
            logger.info(`[Squad Prune] Disbanded ownerless squad ${squad.name} (${squad.id}).`);
        } catch (error) {
            logger.error(`[Squad Prune] Failed to disband squad ${squad.id}:`, error.message);
        }
    }

    // Group prunes per squad so each leader gets one DM.
    const prunesBySquadId = new Map();
    for (const { squad, member } of plan.prune) {
        if (plan.disband.some((s) => s.id === squad.id)) continue;
        if (!prunesBySquadId.has(squad.id)) prunesBySquadId.set(squad.id, { squad, members: [] });
        prunesBySquadId.get(squad.id).members.push(member);
    }

    let prunedCount = 0;
    for (const { squad } of prunesBySquadId.values()) {
        try {
            const pruned = await pruneSquad(guild, guildMemberIds, squad);
            prunedCount += pruned.length;
            if (pruned.length === 0) continue;
            const leaderUser = await client.users.fetch(String(squad.owner_id)).catch(() => null);
            if (leaderUser) {
                const dmContainer = new ContainerBuilder();
                const block = buildTextBlock({
                    title: 'Squad Members Pruned',
                    subtitle: squad.name,
                    lines: [
                        `These members left the server and were removed from **${squad.name}**:`,
                        pruned.map((p) => `- ${p.username}`).join('\n'),
                    ],
                });
                if (block) dmContainer.addTextDisplayComponents(block);
                await leaderUser.send({ flags: MessageFlags.IsComponentsV2, components: [dmContainer] }).catch(() => {});
            }
        } catch (error) {
            logger.error(`[Squad Prune] Failed to prune squad ${squad.id}:`, error.message);
        }
    }

    try {
        const loggingChannel = await guild.channels.fetch(LOGGING_CHANNEL_ID);
        const container = new ContainerBuilder();
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent('## Squad Membership Cleanup'),
            new TextDisplayBuilder().setContent([
                `**Squads checked:** ${squads.length}`,
                `**Ownerless squads disbanded:** ${plan.disband.length}${disbandedNames.length ? ` (${disbandedNames.join(', ')})` : ''}`,
                `**Departed members pruned:** ${prunedCount}`,
            ].join('\n'))
        );
        await loggingChannel.send({ flags: MessageFlags.IsComponentsV2, components: [container] });
    } catch (logError) {
        logger.error('[Squad Prune] Failed to post summary:', logError.message);
    }

    logger.info(`[Squad Prune] Complete. Disbanded ${disbandedNames.length}, pruned ${prunedCount} members.`);
}

module.exports = { planSquadCleanup, pruneSquad, pruneInactiveMembers };
