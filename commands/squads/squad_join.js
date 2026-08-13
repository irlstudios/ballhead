'use strict';

const { SlashCommandBuilder, MessageFlags, ContainerBuilder } = require('discord.js');
const { GYM_CLASS_GUILD_ID, LOGGING_CHANNEL_ID, BOT_BUGS_CHANNEL_ID } = require('../../config/constants');
const { mascotSquads } = require('../../config/squads');
const { buildTextBlock, buildNoticeContainer } = require('../../utils/ui');
const squadDb = require('../../utils/squad_db');
const logger = require('../../utils/logger');

// A Casual+Competitive pair shares its name and roster; members attach to the
// Competitive row (where the import put them), so the pool must never offer
// the Casual row of a pair as a separate join target.
function collapsePairs(pool) {
    const byName = new Map();
    for (const s of pool || []) {
        const existing = byName.get(s.name);
        if (!existing || (existing.squad_type !== 'Competitive' && s.squad_type === 'Competitive')) {
            byName.set(s.name, s);
        }
    }
    return [...byName.values()];
}

function pickRandomSquad(pool) {
    if (!Array.isArray(pool) || pool.length === 0) {
        return null;
    }
    return pool[Math.floor(Math.random() * pool.length)];
}

module.exports = {
    pickRandomSquad,
    collapsePairs,
    data: new SlashCommandBuilder()
        .setName('squad-join-random')
        .setDescription('Attempt to join a random squad that is currently open.'),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const userId = interaction.user.id;
        const userTag = interaction.user.tag;
        const username = interaction.user.username;
        const member = interaction.member;
        const guild = interaction.guild;

        if (!member || !guild) {
            const errorContainer = buildNoticeContainer({
                title: 'Server Required',
                subtitle: 'Random Squad Join',
                lines: ['This command must be run in a server.'],
            });
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer], ephemeral: true });
            return;
        }

        try {
            if ((await squadDb.fetchSquadsByOwner(userId)).length > 0) {
                const infoContainer = buildNoticeContainer({
                    title: 'Already a Leader',
                    subtitle: 'Random Squad Join',
                    lines: ['You are already a squad leader and cannot join another squad.'],
                });
                await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [infoContainer], ephemeral: true });
                return;
            }
            const membership = await squadDb.fetchMembership(userId);
            if (membership) {
                const infoContainer = buildNoticeContainer({
                    title: 'Already in a Squad',
                    subtitle: 'Random Squad Join',
                    lines: [`You are already in squad **${membership.squad.name}**.`, 'You must leave it first.'],
                });
                await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [infoContainer], ephemeral: true });
                return;
            }
            if (!(await squadDb.getInvitesOptIn(userId))) {
                const infoContainer = buildNoticeContainer({
                    title: 'Opted Out',
                    subtitle: 'Random Squad Join',
                    lines: ['You have opted out of squad invitations/joining.', 'Use `/squad opt-in` first.'],
                });
                await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [infoContainer], ephemeral: true });
                return;
            }

            // Two draws: if the first pick fills up in the race window,
            // addSquadMember refuses atomically and one retry usually lands.
            let chosenSquad = null;
            let joined = false;
            for (let attempt = 0; attempt < 2 && !joined; attempt++) {
                const pool = collapsePairs(await squadDb.fetchOpenSquadsWithSpace());
                chosenSquad = pickRandomSquad(pool);
                if (!chosenSquad) {
                    const infoContainer = buildNoticeContainer({
                        title: 'No Open Squads',
                        subtitle: 'Random Squad Join',
                        lines: ['Sorry, there are currently no squads open for joining.'],
                    });
                    await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [infoContainer], ephemeral: true });
                    return;
                }
                const result = await squadDb.addSquadMember(chosenSquad.id, userId, username);
                if (result.ok) {
                    joined = true;
                } else if (result.code === 'ALREADY_MEMBER') {
                    const infoContainer = buildNoticeContainer({
                        title: 'Already in a Squad',
                        subtitle: 'Random Squad Join',
                        lines: ['You are already in a squad. You must leave it first.'],
                    });
                    await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [infoContainer], ephemeral: true });
                    return;
                }
                // FULL or NO_SQUAD: loop once more with a fresh pool.
            }
            if (!joined) {
                const infoContainer = buildNoticeContainer({
                    title: 'All Squads Full',
                    subtitle: 'Random Squad Join',
                    lines: ['Sorry, all open squads filled up before your join could complete. Please try again.'],
                });
                await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [infoContainer], ephemeral: true });
                return;
            }

            logger.info(`User ${userTag} randomly joined squad ${chosenSquad.name}`);

            try {
                await member.setNickname(`[${chosenSquad.name}] ${username}`);
            } catch (nickError) {
                logger.warn(`Failed to set nickname for ${userTag}: ${nickError.message}`);
                const warningContainer = buildNoticeContainer({
                    title: 'Nickname Not Updated',
                    subtitle: 'Manual Update Needed',
                    lines: [`Set it manually to \`[${chosenSquad.name}] ${username}\`.`],
                });
                await interaction.followUp({ flags: MessageFlags.IsComponentsV2, components: [warningContainer], ephemeral: true }).catch(() => {});
            }

            let assignedMascotRole = null;
            if (chosenSquad.event_squad) {
                const mascotInfo = mascotSquads.find(m => m.name === chosenSquad.event_squad);
                if (mascotInfo) {
                    try {
                        const roleToAdd = await guild.roles.fetch(mascotInfo.roleId);
                        if (roleToAdd) {
                            await member.roles.add(roleToAdd);
                            assignedMascotRole = roleToAdd.name;
                        }
                    } catch (roleError) {
                        logger.error(`Failed to add mascot role ${mascotInfo.name} to ${userTag}: ${roleError.message}`);
                    }
                }
            }

            let successDescription = `You have successfully joined the squad: **${chosenSquad.name}** (${chosenSquad.squad_type})!`;
            if (assignedMascotRole) {
                successDescription += `\nYou have also been assigned the **${assignedMascotRole}** role as part of the ongoing event.`;
            }
            const successContainer = new ContainerBuilder();
            const block = buildTextBlock({ title: 'Joined Squad!', subtitle: 'Random Squad Join', lines: [successDescription] });
            if (block) successContainer.addTextDisplayComponents(block);
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [successContainer], ephemeral: true });

            try {
                const leaderUser = await interaction.client.users.fetch(chosenSquad.owner_id);
                let leaderDmDescription = `<@${userId}> (${userTag}) has joined your squad **${chosenSquad.name}** via the random join command!`;
                if (assignedMascotRole) {
                    leaderDmDescription += ` They have been assigned the **${assignedMascotRole}** role.`;
                }
                const leaderDmContainer = new ContainerBuilder();
                const leaderBlock = buildTextBlock({ title: 'New Member Joined!', subtitle: 'Random Squad Join', lines: [leaderDmDescription] });
                if (leaderBlock) leaderDmContainer.addTextDisplayComponents(leaderBlock);
                await leaderUser.send({ flags: MessageFlags.IsComponentsV2, components: [leaderDmContainer] });
            } catch (dmError) {
                logger.error(`Failed to send DM notification to leader ${chosenSquad.owner_id}: ${dmError.message}`);
            }

            try {
                const loggingGuild = await interaction.client.guilds.fetch(GYM_CLASS_GUILD_ID);
                const loggingChannel = await loggingGuild.channels.fetch(LOGGING_CHANNEL_ID);
                let logDescription = `**User:** ${userTag} (<@${userId}>)\n**Joined Squad:** ${chosenSquad.name}\n**Leader:** <@${chosenSquad.owner_id}>`;
                if (assignedMascotRole) {
                    logDescription += `\n**Assigned Mascot Role:** ${assignedMascotRole}`;
                }
                const logContainer = new ContainerBuilder();
                const logBlock = buildTextBlock({ title: 'User Joined Random Squad', subtitle: 'Squad Activity', lines: [logDescription] });
                if (logBlock) logContainer.addTextDisplayComponents(logBlock);
                await loggingChannel.send({ flags: MessageFlags.IsComponentsV2, components: [logContainer] });
            } catch (logError) {
                logger.error('Failed to log random join action:', logError);
            }
        } catch (error) {
            logger.error(`Error processing /squad join-random for ${userTag}:`, error);
            try {
                const errorGuild = await interaction.client.guilds.fetch(GYM_CLASS_GUILD_ID);
                const errorChannel = await errorGuild.channels.fetch(BOT_BUGS_CHANNEL_ID);
                const errorContainer = new ContainerBuilder();
                const errorBlock = buildTextBlock({ title: 'Join Random Squad Error', subtitle: 'Command Failure', lines: [`**User:** ${userTag} (${userId})`, `**Error:** ${error.message}`] });
                if (errorBlock) errorContainer.addTextDisplayComponents(errorBlock);
                await errorChannel.send({ flags: MessageFlags.IsComponentsV2, components: [errorContainer] });
            } catch (logError) {
                logger.error('Failed to log join command error:', logError);
            }
            const replyContainer = buildNoticeContainer({
                title: 'Request Failed',
                subtitle: 'Random Squad Join',
                lines: [`An error occurred: ${error.message || 'Could not process your request. Please try again later.'}`],
            });
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [replyContainer], ephemeral: true }).catch(err => logger.error('Failed to edit reply:', err));
        }
    },
};
