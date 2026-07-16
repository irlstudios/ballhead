'use strict';

const { SlashCommandBuilder, MessageFlags, ContainerBuilder } = require('discord.js');
const logger = require('../../utils/logger');
const { noticePayload, buildTextBlock } = require('../../utils/ui');
const {
    fetchLeaguesByOwner,
    fetchLeaguesByCoOwner,
    countVerifiedGames,
    countReportedGames,
} = require('../../db');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('league-games')
        .setDescription('Show your league\'s verified and reported game counts'),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const userId = interaction.user.id;
            const owned = await fetchLeaguesByOwner(userId);
            const league = owned[0] || (await fetchLeaguesByCoOwner(userId))[0] || null;

            if (!league) {
                return interaction.editReply(
                    noticePayload('You do not own or co-own a registered league.', { title: 'No League Found', subtitle: 'League Games' })
                );
            }

            const verified = await countVerifiedGames(league.league_id);
            const verified30 = await countVerifiedGames(league.league_id, 30);
            const reported = await countReportedGames(league.league_id);

            const container = new ContainerBuilder();
            const block = buildTextBlock({
                title: 'League Games',
                subtitle: league.league_name,
                lines: [
                    `**Verified games (all time):** ${verified}`,
                    `**Verified games (last 30 days):** ${verified30}`,
                    `**Total reported games:** ${reported}`,
                    '',
                    '-# Verified = Official Verified or Staff Verified. This is the games-played metric.',
                ],
            });
            if (block) container.addTextDisplayComponents(block);
            return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container] });
        } catch (error) {
            logger.error('[League Games] Error:', error);
            return interaction.editReply(
                noticePayload('An error occurred while fetching game counts.', { title: 'Failed', subtitle: 'League Games' })
            );
        }
    },
};
