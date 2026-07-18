'use strict';

const { SlashCommandBuilder } = require('discord.js');
const logger = require('../../utils/logger');
const { noticePayload } = require('../../utils/ui');
const { fetchLeaguesByOwner, updateLeagueContentSettings } = require('../../db');
const { normalizeHashtag, isValidHashtag } = require('../../utils/league_content');

const SUB = 'League Settings';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('league-settings')
        .setDescription('Set your league\'s sport and content hashtag')
        .addStringOption((o) => o.setName('sport').setDescription('Primary sport / format').setRequired(false).setMaxLength(60))
        .addStringOption((o) => o.setName('hashtag').setDescription('Content hashtag (letters, digits, underscore)').setRequired(false).setMaxLength(30)),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const sport = interaction.options.getString('sport');
            const rawHashtag = interaction.options.getString('hashtag');

            if (!sport && !rawHashtag) {
                return interaction.editReply(noticePayload('Provide a sport and/or a hashtag to update.', { title: 'Nothing to Update', subtitle: SUB }));
            }

            let hashtag = null;
            if (rawHashtag) {
                if (!isValidHashtag(rawHashtag)) {
                    return interaction.editReply(noticePayload('Hashtag must be 2-30 characters: letters, digits, or underscore.', { title: 'Invalid Hashtag', subtitle: SUB }));
                }
                hashtag = normalizeHashtag(rawHashtag);
            }

            const leagues = await fetchLeaguesByOwner(interaction.user.id);
            const league = leagues[0] || null;
            if (!league) {
                return interaction.editReply(noticePayload('You do not own a registered league.', { title: 'No League Found', subtitle: SUB }));
            }

            try {
                await updateLeagueContentSettings(league.league_id, { sport: sport || null, hashtag });
            } catch (error) {
                if (error.code === '23505') {
                    return interaction.editReply(noticePayload('That hashtag is already used by another league. Pick a different one.', { title: 'Hashtag Taken', subtitle: SUB }));
                }
                throw error;
            }

            const lines = [];
            if (sport) lines.push(`**Sport:** ${sport}`);
            if (hashtag) lines.push(`**Hashtag:** #${hashtag}`);
            return interaction.editReply(noticePayload(['Settings updated.', ...lines], { title: 'Settings Updated', subtitle: league.league_name }));
        } catch (error) {
            logger.error('[Content] league-settings failed:', error);
            return interaction.editReply(noticePayload('An error occurred while updating settings.', { title: 'Settings Error', subtitle: SUB }));
        }
    },
};
