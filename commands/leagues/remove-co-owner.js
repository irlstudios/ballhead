'use strict';

const { SlashCommandBuilder, MessageFlags, ContainerBuilder } = require('discord.js');
const logger = require('../../utils/logger');
const { noticePayload, buildTextBlock } = require('../../utils/ui');
const { fetchLeaguesByOwner, removeCoOwner } = require('../../db');
const {
    LEAGUE_CO_OWNER_ROLE_ID,
    LEAGUE_LOG_CHANNEL_ID,
} = require('../../config/constants');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('remove-co-owner')
        .setDescription('Remove a co-owner from your league')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The co-owner to remove')
                .setRequired(true)),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const targetUser = interaction.options.getUser('user');
            const callerId = interaction.user.id;

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

            if (league.co_owner_1 !== targetUser.id && league.co_owner_2 !== targetUser.id) {
                return interaction.editReply(
                    noticePayload('This user is not a co-owner of your league.', {
                        title: 'Not a Co-Owner',
                        subtitle: 'Co-Owner',
                    })
                );
            }

            await removeCoOwner(league.league_id, targetUser.id);

            const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
            if (targetMember) {
                await targetMember.roles.remove(LEAGUE_CO_OWNER_ROLE_ID).catch(() => {});
            }

            await interaction.editReply(
                noticePayload(`Removed <@${targetUser.id}> as co-owner of **${league.league_name}**.`, {
                    title: 'Co-Owner Removed',
                    subtitle: league.league_name,
                })
            );

            const logChannel = await interaction.client.channels.fetch(LEAGUE_LOG_CHANNEL_ID).catch(() => null);
            if (logChannel) {
                const container = new ContainerBuilder();
                const block = buildTextBlock({
                    title: 'Co-Owner Removed',
                    subtitle: league.league_name,
                    lines: [
                        `**Owner:** <@${callerId}>`,
                        `**Removed:** <@${targetUser.id}>`,
                    ],
                });
                if (block) container.addTextDisplayComponents(block);
                await logChannel.send({ flags: MessageFlags.IsComponentsV2, components: [container] });
            }
        } catch (error) {
            logger.error('[Remove Co-Owner] Error:', error);
            return interaction.editReply(
                noticePayload('An error occurred while removing the co-owner.', {
                    title: 'Failed',
                    subtitle: 'Co-Owner',
                })
            );
        }
    },
};
