'use strict';

const { SlashCommandBuilder, MessageFlags, ContainerBuilder } = require('discord.js');
const { GYM_CLASS_GUILD_ID, LOGGING_CHANNEL_ID, BOT_BUGS_CHANNEL_ID } = require('../../config/constants');
const { findMascotByName } = require('../../config/squads');
const { buildTextBlock, buildNoticeContainer } = require('../../utils/ui');
const squadDb = require('../../utils/squad_db');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('squad-leave')
        .setDescription('Leave your current squad'),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const userId = interaction.user.id;
        const userTag = interaction.user.tag;
        const member = interaction.member;
        const guild = interaction.guild;

        if (!member || !guild) {
            const errorContainer = buildNoticeContainer({
                title: 'Server Info Missing',
                subtitle: 'Leave Squad',
                lines: ['Could not retrieve necessary server information.'],
            });
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer], ephemeral: true });
            return;
        }

        try {
            if ((await squadDb.fetchSquadsByOwner(userId)).length > 0) {
                const infoContainer = buildNoticeContainer({
                    title: 'Leaders Must Disband',
                    subtitle: 'Leave Squad',
                    lines: ['Squad leaders cannot leave their squad using this command.', 'Please use `/squad disband`.'],
                });
                return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [infoContainer], ephemeral: true });
            }

            const removed = await squadDb.removeMembershipAnywhere(userId);
            if (!removed) {
                const infoContainer = buildNoticeContainer({
                    title: 'No Squad Found',
                    subtitle: 'Leave Squad',
                    lines: ['You are not currently in a squad.'],
                });
                return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [infoContainer], ephemeral: true });
            }

            const squad = await squadDb.fetchSquadById(removed.squad_id);
            const squadName = squad?.name || 'your squad';
            logger.info(`User ${userTag} (${userId}) left squad: ${squadName}`);

            try {
                if (member.nickname && member.nickname.toUpperCase().startsWith(`[${squadName.toUpperCase()}]`)) {
                    await member.setNickname(null).catch(nickError => {
                        if (nickError.code !== 50013) logger.info(`Could not reset nickname for ${userTag}: ${nickError.message}`);
                    });
                }
                const mascot = squad?.event_squad ? findMascotByName(squad.event_squad) : null;
                if (mascot && member.roles.cache.has(mascot.roleId)) {
                    await member.roles.remove(mascot.roleId).catch(roleError => {
                        if (roleError.code !== 50013) logger.info(`Could not remove mascot role from ${userTag}: ${roleError.message}`);
                    });
                }
            } catch (error) {
                logger.error(`Error during nickname/role cleanup for ${userTag} (${userId}): ${error.message}`);
            }

            if (squad) {
                try {
                    const ownerUser = await interaction.client.users.fetch(squad.owner_id);
                    const dmContainer = new ContainerBuilder();
                    const block = buildTextBlock({
                        title: 'Member Left Squad',
                        subtitle: 'Squad Update',
                        lines: [`Hello ${squad.owner_username || 'Leader'},`, `User **${userTag}** (<@${userId}>) has left your squad **${squadName}**.`],
                    });
                    if (block) dmContainer.addTextDisplayComponents(block);
                    await ownerUser.send({ flags: MessageFlags.IsComponentsV2, components: [dmContainer] }).catch(dmError => {
                        logger.error(`Failed to DM squad leader ${squad.owner_id}: ${dmError.message}`);
                    });
                } catch (fetchError) {
                    logger.warn(`Could not fetch squad leader ${squad.owner_id} to notify: ${fetchError.message}`);
                }
            }

            try {
                const loggingGuild = await interaction.client.guilds.fetch(GYM_CLASS_GUILD_ID);
                const loggingChannel = await loggingGuild.channels.fetch(LOGGING_CHANNEL_ID);
                const logContainer = new ContainerBuilder();
                const logBlock = buildTextBlock({
                    title: 'Member Left Squad',
                    subtitle: 'Squad Activity',
                    lines: [`**${userTag}** (<@${userId}>) left squad **${squadName}**.`],
                });
                if (logBlock) logContainer.addTextDisplayComponents(logBlock);
                await loggingChannel.send({ flags: MessageFlags.IsComponentsV2, components: [logContainer] });
            } catch (logError) {
                logger.error('Failed to log squad leave:', logError);
            }

            const successContainer = buildNoticeContainer({
                title: 'Left Squad',
                subtitle: squadName,
                lines: [`You have left **${squadName}**.`],
            });
            return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [successContainer], ephemeral: true });
        } catch (error) {
            logger.error(`Error during /squad leave for ${userTag}:`, error);
            try {
                const errorGuild = await interaction.client.guilds.fetch(GYM_CLASS_GUILD_ID);
                const errorChannel = await errorGuild.channels.fetch(BOT_BUGS_CHANNEL_ID);
                const errorContainer = new ContainerBuilder();
                const errorBlock = buildTextBlock({
                    title: 'Squad Leave Error',
                    subtitle: 'Command Failure',
                    lines: [`**User:** ${userTag} (${userId})`, `**Error:** ${error.message}`],
                });
                if (errorBlock) errorContainer.addTextDisplayComponents(errorBlock);
                await errorChannel.send({ flags: MessageFlags.IsComponentsV2, components: [errorContainer] });
            } catch (logError) {
                logger.error('Failed to log leave command error:', logError);
            }
            const replyContainer = buildNoticeContainer({
                title: 'Request Failed',
                subtitle: 'Leave Squad',
                lines: ['An error occurred while leaving your squad. Please try again later.'],
            });
            return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [replyContainer], ephemeral: true }).catch(err => logger.error('Failed to edit reply:', err));
        }
    },
};
