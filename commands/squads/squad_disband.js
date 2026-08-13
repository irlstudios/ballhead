'use strict';

const { SlashCommandBuilder, MessageFlags, ContainerBuilder } = require('discord.js');
const {
    GYM_CLASS_GUILD_ID, LOGGING_CHANNEL_ID,
    SQUAD_LEADER_ROLE_ID, COMPETITIVE_SQUAD_OWNER_ROLE_ID,
} = require('../../config/constants');
const { findMascotByName } = require('../../config/squads');
const { buildTextBlock, buildNoticeContainer } = require('../../utils/ui');
const squadDb = require('../../utils/squad_db');
const logger = require('../../utils/logger');

// Role ids to remove from the owner after a disband: the leader role only
// when no squads remain at all, the competitive-owner role only when a
// Competitive squad was disbanded and none remain.
function ownerRolesAfterDisband({ remainingSquads, disbandedTypes }) {
    const roles = [];
    if (remainingSquads.length === 0) {
        roles.push(SQUAD_LEADER_ROLE_ID);
    }
    const stillOwnsComp = remainingSquads.some((s) => s.squad_type === 'Competitive');
    if (disbandedTypes.includes('Competitive') && !stillOwnsComp) {
        roles.push(COMPETITIVE_SQUAD_OWNER_ROLE_ID);
    }
    return roles;
}

// Shared teardown for disband and force-disband: DMs + nickname resets +
// mascot-role removal for members, then role cleanup for the owner.
async function teardownDisbandedSquads(client, guild, disbanded, { byModerator = false } = {}) {
    for (const { squad, members } of disbanded) {
        const mascot = squad.event_squad ? findMascotByName(squad.event_squad) : null;
        for (const m of members) {
            try {
                const member = await guild.members.fetch(m.user_id);
                const dmContainer = new ContainerBuilder();
                const block = buildTextBlock({
                    title: 'Squad Disbanded',
                    subtitle: byModerator ? 'Moderator Action' : 'Squad Update',
                    lines: [`The squad **${squad.name}** you were in has been disbanded${byModerator ? ' by a moderator' : ' by the squad leader'}.`],
                });
                if (block) dmContainer.addTextDisplayComponents(block);
                await member.send({ flags: MessageFlags.IsComponentsV2, components: [dmContainer] }).catch(err => logger.info(`Failed to DM ${m.user_id}: ${err.message}`));

                if (member.nickname && member.nickname.toUpperCase().startsWith(`[${squad.name}]`)) {
                    await member.setNickname(member.user.username).catch(nickError => {
                        if (nickError.code !== 50013) logger.info(`Could not reset nickname for ${member.user.tag}: ${nickError.message}`);
                    });
                }
                if (mascot && member.roles.cache.has(mascot.roleId)) {
                    await member.roles.remove(mascot.roleId).catch(roleErr => {
                        if (roleErr.code !== 50013 && roleErr.code !== 10011) {
                            logger.info(`Failed to remove mascot role from ${member.user.tag}: ${roleErr.message}`);
                        }
                    });
                }
            } catch (fetchError) {
                if (fetchError.code === 10007) logger.info(`Member ${m.user_id} not found in guild, skipping cleanup.`);
                else logger.info(`Could not fetch member ${m.user_id} for cleanup: ${fetchError.message}`);
            }
        }
    }

    const ownerId = disbanded[0].squad.owner_id;
    const squadName = disbanded[0].squad.name;
    try {
        const leader = await guild.members.fetch(ownerId);
        const remainingSquads = await squadDb.fetchSquadsByOwner(ownerId);
        const rolesToRemove = ownerRolesAfterDisband({
            remainingSquads,
            disbandedTypes: disbanded.map((d) => d.squad.squad_type),
        });
        const mascot = disbanded[0].squad.event_squad ? findMascotByName(disbanded[0].squad.event_squad) : null;
        if (mascot) rolesToRemove.push(mascot.roleId);
        const held = rolesToRemove.filter((id) => leader.roles.cache.has(id));
        if (held.length > 0) {
            await leader.roles.remove(held).catch(roleErr => {
                if (roleErr.code !== 50013 && roleErr.code !== 10011) {
                    logger.info(`Failed to remove owner roles from ${leader.user.tag}: ${roleErr.message}`);
                }
            });
        }
        if (leader.nickname && leader.nickname.toUpperCase().startsWith(`[${squadName}]`)) {
            await leader.setNickname(leader.user.username).catch(nickError => {
                if (nickError.code !== 50013) logger.info(`Could not reset nickname for leader ${leader.user.tag}: ${nickError.message}`);
            });
        }
    } catch (fetchError) {
        if (fetchError.code === 10007) logger.info(`Leader ${ownerId} not found in guild, skipping cleanup.`);
        else logger.info(`Could not fetch leader ${ownerId} for cleanup: ${fetchError.message}`);
    }
}

module.exports = {
    ownerRolesAfterDisband,
    teardownDisbandedSquads,
    data: new SlashCommandBuilder()
        .setName('squad-disband')
        .setDescription('Disband your squad if you are the squad leader.')
        .addStringOption(opt =>
            opt.setName('squad')
                .setDescription('Squad name (required if you own multiple)')
                .setRequired(false)
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const userId = interaction.user.id;
        const userTag = interaction.user.tag;
        const guild = interaction.guild;

        try {
            const specifiedSquad = interaction.options.getString('squad');
            const ownedSquads = await squadDb.fetchSquadsByOwner(userId);
            const { squad, error } = squadDb.disambiguateOwnedSquad(ownedSquads, specifiedSquad);
            if (error) {
                const infoContainer = buildNoticeContainer({
                    title: 'Disband Squad',
                    subtitle: 'Squad Selection',
                    lines: [error],
                });
                return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [infoContainer], ephemeral: true });
            }

            // A Casual+Competitive pair shares its name and disbands together,
            // matching the sheet-era behavior of clearing every row by name.
            const rowsToDisband = ownedSquads.filter((s) => s.name === squad.name);
            const disbanded = [];
            for (const row of rowsToDisband) {
                const result = await squadDb.disbandSquad(row.id, { ownerId: userId });
                if (result) disbanded.push(result);
            }
            if (disbanded.length === 0) {
                const infoContainer = buildNoticeContainer({
                    title: 'Already Disbanded',
                    subtitle: 'Disband Squad',
                    lines: ['Your squad no longer exists. No changes were made.'],
                });
                return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [infoContainer], ephemeral: true });
            }

            await teardownDisbandedSquads(interaction.client, guild, disbanded);

            const loggingChannel = await interaction.client.guilds.fetch(GYM_CLASS_GUILD_ID)
                .then(g => g?.channels.fetch(LOGGING_CHANNEL_ID)).catch(() => null);
            if (loggingChannel) {
                try {
                    const logContainer = new ContainerBuilder();
                    const block = buildTextBlock({ title: 'Squad Disbanded', subtitle: 'Moderator Log', lines: [`The squad **${squad.name}** was disbanded by **${userTag}** (${userId}).`] });
                    if (block) logContainer.addTextDisplayComponents(block);
                    await loggingChannel.send({ flags: MessageFlags.IsComponentsV2, components: [logContainer] });
                } catch (logError) {
                    logger.error('Failed to send log message:', logError);
                }
            }

            const successContainer = new ContainerBuilder();
            const block = buildTextBlock({
                title: 'Squad Disbanded',
                subtitle: 'Disband Squad',
                lines: [
                    `Your squad **${squad.name}** has been successfully disbanded.`,
                    'Members have been notified, roles removed, and nicknames reset (where possible).',
                ],
            });
            if (block) successContainer.addTextDisplayComponents(block);
            return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [successContainer], ephemeral: true });
        } catch (error) {
            logger.error('Error during the disband-squad command execution:', error);
            const errorContainer = buildNoticeContainer({
                title: 'Disband Failed',
                subtitle: 'Disband Squad',
                lines: [`An error occurred while disbanding the squad. ${error.message || 'Please try again later.'}`],
            });
            return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer], ephemeral: true }).catch(err => logger.error('Failed to edit reply:', err));
        }
    },
};
