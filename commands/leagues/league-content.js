'use strict';

const { SlashCommandBuilder } = require('discord.js');
const logger = require('../../utils/logger');
const { noticePayload } = require('../../utils/ui');
const { fetchLeaguesByOwner, fetchLeaguesByCoOwner, getLeagueContentSummary } = require('../../db');
const { buildContentSummaryLine } = require('../../utils/league_content');

const SUB = 'League Content';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('league-content')
        .setDescription('View your league\'s content hashtag and view totals'),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const userId = interaction.user.id;
            const owned = await fetchLeaguesByOwner(userId);
            const coowned = await fetchLeaguesByCoOwner(userId);
            const league = [...owned, ...coowned][0] || null;

            if (!league) {
                return interaction.editReply(noticePayload('You do not own or co-own a registered league.', { title: 'No League Found', subtitle: SUB }));
            }

            const summary = await getLeagueContentSummary(league.league_id);

            const lines = league.league_hashtag
                ? [`**Hashtag:** #${league.league_hashtag}`, 'Post with this hashtag and your content is counted automatically.']
                : ['No hashtag set. Use `/league-settings` to set one starting with #gc.'];
            lines.push(buildContentSummaryLine(summary));

            return interaction.editReply(noticePayload(lines, { title: league.league_name, subtitle: SUB }));
        } catch (error) {
            logger.error('[Content] league-content failed:', error);
            return interaction.editReply(noticePayload('An error occurred while fetching content.', { title: 'Content Error', subtitle: SUB }));
        }
    },
};
