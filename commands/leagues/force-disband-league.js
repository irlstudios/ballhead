'use strict';

const { SlashCommandBuilder } = require('discord.js');
const logger = require('../../utils/logger');
const { noticePayload } = require('../../utils/ui');
const {
    findActiveLeagueByName,
    markLeagueDisbanded,
    insertLeagueCreationBlock,
} = require('../../db');
const {
    MODERATOR_ROLES,
    LEAGUE_CO_OWNER_ROLE_ID,
    LEAGUE_LOG_CHANNEL_ID,
} = require('../../config/constants');
const { buildDisbandPlan } = require('../../utils/league_disband');

function futureEligibilityLine(blocked) {
    return blocked
        ? 'The owner is **not** permitted to register a new league in the future.'
        : 'The owner may apply to register a new league again in the future.';
}

async function dmUser(client, userId, payload) {
    const user = await client.users.fetch(userId).catch(() => null);
    if (!user) {
        return;
    }
    await user.send(payload).catch((error) => {
        logger.info(`[Force Disband League] Could not DM ${userId}: ${error.message}`);
    });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('force-disband-league')
        .setDescription('Force disband a league by name (Mods only).')
        .addStringOption(option =>
            option.setName('league-name')
                .setDescription('The name of the league to disband.')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Why this league is being disbanded.')
                .setRequired(true))
        .addBooleanOption(option =>
            option.setName('block-owner')
                .setDescription('Prevent the owner from registering a new league in the future.')
                .setRequired(true)),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const isMod = MODERATOR_ROLES.some(roleId => interaction.member.roles.cache.has(roleId));
            if (!isMod) {
                return interaction.editReply(
                    noticePayload('You do not have permission to use this command.', {
                        title: 'Access Denied',
                        subtitle: 'Force Disband League',
                    })
                );
            }

            const leagueName = interaction.options.getString('league-name');
            const reason = interaction.options.getString('reason');
            const blockOwner = interaction.options.getBoolean('block-owner');

            const league = await findActiveLeagueByName(leagueName);
            if (!league) {
                return interaction.editReply(
                    noticePayload(`No active league matching **${leagueName}** was found.`, {
                        title: 'League Not Found',
                        subtitle: 'Force Disband League',
                    })
                );
            }

            const plan = buildDisbandPlan(league);

            // Block first, disband second: if the disband fails the mod simply
            // re-runs and the block upserts again. The reverse order would
            // strand an unblocked owner behind the already-disbanded early
            // return below.
            if (blockOwner) {
                await insertLeagueCreationBlock(plan.ownerId, reason, interaction.user.id);
            }

            const disbanded = await markLeagueDisbanded(plan.leagueId, plan.ownerId);
            if (!disbanded) {
                return interaction.editReply(
                    noticePayload(
                        [
                            'This league has already been disbanded.',
                            blockOwner ? 'The owner has still been blocked from registering a new league.' : null,
                        ].filter(Boolean),
                        { title: 'Already Disbanded', subtitle: plan.leagueName }
                    )
                );
            }

            const failures = [];

            const owner = await interaction.guild.members.fetch(plan.ownerId).catch(() => null);
            if (owner && plan.ownerRolesToRemove.length > 0) {
                await owner.roles.remove(plan.ownerRolesToRemove).catch((error) => {
                    failures.push('owner league roles');
                    logger.error(`[Force Disband League] Could not remove owner roles from ${plan.ownerId}: ${error.message}`);
                });
            } else if (!owner && plan.ownerRolesToRemove.length > 0) {
                failures.push('owner league roles (owner not in server)');
            }

            await dmUser(interaction.client, plan.ownerId, noticePayload(
                [
                    `Your league **${plan.leagueName}** has been disbanded by a moderator.`,
                    `**Reason:** ${reason}`,
                    '',
                    blockOwner
                        ? 'You are **not** permitted to register a new league in the future.'
                        : 'You may apply to register a new league again in the future.',
                ],
                { title: 'League Disbanded', subtitle: 'Moderator Action' }
            ));

            for (const coOwnerId of plan.coOwnerIds) {
                const member = await interaction.guild.members.fetch(coOwnerId).catch(() => null);
                if (member) {
                    await member.roles.remove(LEAGUE_CO_OWNER_ROLE_ID).catch((error) => {
                        failures.push(`co-owner role (${coOwnerId})`);
                        logger.info(`[Force Disband League] Could not remove co-owner role from ${coOwnerId}: ${error.message}`);
                    });
                }
                await dmUser(interaction.client, coOwnerId, noticePayload(
                    `The league **${plan.leagueName}**, where you were a co-owner, has been disbanded by a moderator.`,
                    { title: 'League Disbanded', subtitle: 'Moderator Action' }
                ));
            }

            const logChannel = await interaction.client.channels.fetch(LEAGUE_LOG_CHANNEL_ID).catch(() => null);
            if (logChannel) {
                await logChannel.send(noticePayload(
                    [
                        `**League:** ${plan.leagueName}`,
                        `**Owner:** <@${plan.ownerId}>`,
                        `**Moderator:** ${interaction.user.tag} (${interaction.user.id})`,
                        `**Reason:** ${reason}`,
                        futureEligibilityLine(blockOwner),
                    ],
                    { title: 'League Force Disbanded', subtitle: 'Moderator Action' }
                )).catch((error) => {
                    logger.error(`[Force Disband League] Failed to post log: ${error.message}`);
                });
            }

            const lines = [
                `The league **${plan.leagueName}** has been disbanded.`,
                `**Reason:** ${reason}`,
                futureEligibilityLine(blockOwner),
            ];
            if (failures.length > 0) {
                lines.push('', `Some Discord cleanup could not be completed automatically (${failures.join(', ')}).`);
            }

            return interaction.editReply(
                noticePayload(lines, { title: 'League Force Disbanded', subtitle: plan.leagueName })
            );
        } catch (error) {
            logger.error('[Force Disband League] Error:', error);
            await interaction.editReply(
                noticePayload('An error occurred while disbanding the league.', {
                    title: 'Force Disband Failed',
                    subtitle: 'Force Disband League',
                })
            ).catch(err => logger.error('[Force Disband League] Failed to edit reply:', err));
        }
    },
};
