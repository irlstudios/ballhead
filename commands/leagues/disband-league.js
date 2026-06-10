'use strict';

const {
    SlashCommandBuilder,
    MessageFlags,
    ContainerBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    ComponentType,
} = require('discord.js');
const logger = require('../../utils/logger');
const { noticePayload, buildTextBlock } = require('../../utils/ui');
const { fetchLeaguesByOwner, markLeagueDisbanded } = require('../../db');
const { LEAGUE_CO_OWNER_ROLE_ID } = require('../../config/constants');
const { buildDisbandPlan } = require('../../utils/league_disband');

const CONFIRM_ID = 'disband-league-confirm';
const CANCEL_ID = 'disband-league-cancel';
const CONFIRM_TIMEOUT_MS = 60_000;

function buildConfirmComponents(league, coOwnerIds) {
    const container = new ContainerBuilder();
    const block = buildTextBlock({
        title: 'Disband League?',
        subtitle: league.league_name,
        lines: [
            'This will disband your league. **This cannot be undone.**',
            '',
            `**Tier:** ${league.league_type || 'Unknown'}`,
            `**Server:** ${league.server_name || 'Unknown'}`,
            `**Co-Owners:** ${coOwnerIds.length > 0 ? coOwnerIds.map(id => `<@${id}>`).join(', ') : 'None'}`,
            '',
            'Your league roles will be removed and any co-owners will be notified.',
        ],
    });
    if (block) container.addTextDisplayComponents(block);

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(CONFIRM_ID).setLabel('Disband League').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(CANCEL_ID).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    );

    return [container, row];
}

// Remove a co-owner's role (only possible while they are in the guild) and DM
// them about the disband. The DM is attempted independently via the user cache
// so a co-owner who has left the guild is still notified where possible.
async function notifyCoOwner(client, guild, coOwnerId, leagueName) {
    const member = await guild.members.fetch(coOwnerId).catch(() => null);
    if (member) {
        await member.roles.remove(LEAGUE_CO_OWNER_ROLE_ID).catch((error) => {
            logger.info(`[Disband League] Could not remove co-owner role from ${coOwnerId}: ${error.message}`);
        });
    }

    const user = member ? member.user : await client.users.fetch(coOwnerId).catch(() => null);
    if (!user) {
        return;
    }
    const container = new ContainerBuilder();
    const block = buildTextBlock({
        title: 'League Disbanded',
        subtitle: leagueName,
        lines: [`The league **${leagueName}**, where you were a co-owner, has been disbanded by the owner.`],
    });
    if (block) container.addTextDisplayComponents(block);
    await user.send({ flags: MessageFlags.IsComponentsV2, components: [container] }).catch((error) => {
        logger.info(`[Disband League] Could not DM co-owner ${coOwnerId}: ${error.message}`);
    });
}

async function performDisband(interaction, league) {
    const plan = buildDisbandPlan(league);

    // Atomic, owner-scoped soft delete. Returns false if the league was already
    // disbanded (e.g. a duplicate/stale confirmation), in which case we stop
    // before running any Discord teardown.
    const disbanded = await markLeagueDisbanded(plan.leagueId, plan.ownerId);
    if (!disbanded) {
        return interaction.editReply(
            noticePayload('This league has already been disbanded. No changes were made.', {
                title: 'Already Disbanded',
                subtitle: plan.leagueName,
            })
        );
    }

    const failures = [];

    if (plan.ownerRolesToRemove.length > 0) {
        const owner = await interaction.guild.members.fetch(plan.ownerId).catch(() => null);
        if (owner) {
            await owner.roles.remove(plan.ownerRolesToRemove).catch((error) => {
                failures.push('owner league roles');
                logger.error(`[Disband League] Could not remove owner roles from ${plan.ownerId}: ${error.message}`);
            });
        } else {
            failures.push('owner league roles (owner not in server)');
            logger.info(`[Disband League] Owner ${plan.ownerId} not in guild; owner roles not removed.`);
        }
    }

    for (const coOwnerId of plan.coOwnerIds) {
        await notifyCoOwner(interaction.client, interaction.guild, coOwnerId, plan.leagueName);
    }

    const lines = [`Your league **${plan.leagueName}** has been disbanded.`];
    if (failures.length > 0) {
        lines.push(
            '',
            `Some Discord cleanup could not be completed automatically (${failures.join(', ')}). An admin may need to finish it manually.`
        );
    } else {
        lines.push(`League roles have been removed${plan.coOwnerIds.length > 0 ? ' and co-owners notified' : ''}.`);
    }

    return interaction.editReply(
        noticePayload(lines, { title: 'League Disbanded', subtitle: plan.leagueName })
    );
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('disband-league')
        .setDescription('Disband a league you own. This cannot be undone.'),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const callerId = interaction.user.id;
            const leagues = await fetchLeaguesByOwner(callerId);
            const league = leagues.find(l => l.league_status !== 'Disbanded');

            if (!league) {
                return interaction.editReply(
                    noticePayload('You do not own an active league to disband.', {
                        title: 'No League Found',
                        subtitle: 'Disband League',
                    })
                );
            }

            const plan = buildDisbandPlan(league);
            const reply = await interaction.editReply({
                flags: MessageFlags.IsComponentsV2,
                components: buildConfirmComponents(league, plan.coOwnerIds),
            });

            let choice;
            try {
                choice = await reply.awaitMessageComponent({
                    filter: i => i.user.id === callerId,
                    componentType: ComponentType.Button,
                    time: CONFIRM_TIMEOUT_MS,
                });
            } catch {
                return interaction.editReply(
                    noticePayload('Disband confirmation timed out. No changes were made.', {
                        title: 'Timed Out',
                        subtitle: league.league_name,
                    })
                );
            }

            if (choice.customId === CANCEL_ID) {
                return choice.update(
                    noticePayload('Disband cancelled. Your league is unchanged.', {
                        title: 'Cancelled',
                        subtitle: league.league_name,
                    })
                );
            }

            // Replace the confirmation (removing the buttons) with a working
            // state before the slow teardown, then post the final result.
            await choice.update(
                noticePayload('Disbanding your league...', {
                    title: 'Disbanding',
                    subtitle: league.league_name,
                })
            );
            await performDisband(interaction, league);
        } catch (error) {
            logger.error('[Disband League] Error:', error);
            await interaction.editReply(
                noticePayload('An error occurred while disbanding the league. Please contact an admin.', {
                    title: 'Disband Failed',
                    subtitle: 'Disband League',
                })
            ).catch(err => logger.error('[Disband League] Failed to edit reply:', err));
        }
    },
};
