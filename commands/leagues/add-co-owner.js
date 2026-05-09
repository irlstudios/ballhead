'use strict';

const { SlashCommandBuilder, MessageFlags, ContainerBuilder } = require('discord.js');
const logger = require('../../utils/logger');
const { noticePayload, buildTextBlock } = require('../../utils/ui');
const {
    fetchLeaguesByOwner,
    isUserCoOwnerAnywhere,
    addCoOwner,
} = require('../../db');
const {
    LEAGUE_CO_OWNER_ROLE_ID,
    LEAGUE_LOG_CHANNEL_ID,
} = require('../../config/constants');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('add-co-owner')
        .setDescription('Add a co-owner to your league (max 2)')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to add as co-owner')
                .setRequired(true)),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const targetUser = interaction.options.getUser('user');
            const callerId = interaction.user.id;

            if (targetUser.id === callerId) {
                return interaction.editReply(
                    noticePayload('You cannot add yourself as a co-owner.', {
                        title: 'Invalid Target',
                        subtitle: 'Co-Owner',
                    })
                );
            }

            if (targetUser.bot) {
                return interaction.editReply(
                    noticePayload('Bots cannot be co-owners.', {
                        title: 'Invalid Target',
                        subtitle: 'Co-Owner',
                    })
                );
            }

            const leagues = await fetchLeaguesByOwner(callerId);
            if (leagues.length === 0) {
                return interaction.editReply(
                    noticePayload('You do not own any registered leagues.', {
                        title: 'No League Found',
                        subtitle: 'Co-Owner',
                    })
                );
            }

            const league = leagues[0];

            if (league.co_owner_1 && league.co_owner_2) {
                return interaction.editReply(
                    noticePayload('Your league already has 2 co-owners. Remove one first with `/remove-co-owner`.', {
                        title: 'Slots Full',
                        subtitle: 'Co-Owner',
                    })
                );
            }

            if (league.co_owner_1 === targetUser.id || league.co_owner_2 === targetUser.id) {
                return interaction.editReply(
                    noticePayload('This user is already a co-owner of your league.', {
                        title: 'Already Co-Owner',
                        subtitle: 'Co-Owner',
                    })
                );
            }

            const targetOwnsLeague = await fetchLeaguesByOwner(targetUser.id);
            if (targetOwnsLeague.length > 0) {
                return interaction.editReply(
                    noticePayload('This user already owns a league and cannot be a co-owner.', {
                        title: 'Owns a League',
                        subtitle: 'Co-Owner',
                    })
                );
            }

            const alreadyCoOwner = await isUserCoOwnerAnywhere(targetUser.id);
            if (alreadyCoOwner) {
                return interaction.editReply(
                    noticePayload('This user is already a co-owner of another league.', {
                        title: 'Already Co-Owner Elsewhere',
                        subtitle: 'Co-Owner',
                    })
                );
            }

            const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
            if (!targetMember) {
                return interaction.editReply(
                    noticePayload('This user is not a member of this server.', {
                        title: 'Not in Server',
                        subtitle: 'Co-Owner',
                    })
                );
            }

            await addCoOwner(league.league_id, targetUser.id);
            await targetMember.roles.add(LEAGUE_CO_OWNER_ROLE_ID).catch(() => {});

            await interaction.editReply(
                noticePayload(`Added <@${targetUser.id}> as a co-owner of **${league.league_name}**.`, {
                    title: 'Co-Owner Added',
                    subtitle: league.league_name,
                })
            );

            const logChannel = await interaction.client.channels.fetch(LEAGUE_LOG_CHANNEL_ID).catch(() => null);
            if (logChannel) {
                const container = new ContainerBuilder();
                const block = buildTextBlock({
                    title: 'Co-Owner Added',
                    subtitle: league.league_name,
                    lines: [
                        `**Owner:** <@${callerId}>`,
                        `**Co-Owner:** <@${targetUser.id}>`,
                    ],
                });
                if (block) container.addTextDisplayComponents(block);
                await logChannel.send({ flags: MessageFlags.IsComponentsV2, components: [container] });
            }
        } catch (error) {
            logger.error('[Add Co-Owner] Error:', error);
            return interaction.editReply(
                noticePayload('An error occurred while adding the co-owner.', {
                    title: 'Failed',
                    subtitle: 'Co-Owner',
                })
            );
        }
    },
};
