'use strict';

const { SlashCommandBuilder } = require('discord.js');
const logger = require('../../utils/logger');
const { noticePayload } = require('../../utils/ui');
const { fetchLeaguesByOwner, fetchLeaguesByCoOwner, updateLeagueContentSettings } = require('../../db');
const { normalizeHashtag, isValidHashtag } = require('../../utils/league_content');

const SUB = 'League Settings';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('league-settings')
        .setDescription('Set your league\'s sport and content hashtag')
        .addStringOption((o) => o.setName('sport').setDescription('Primary sport / format').setRequired(false).setMaxLength(60))
        .addStringOption((o) => o.setName('hashtag').setDescription('Content hashtag, must start with #gc (e.g. #gcskyballers)').setRequired(false).setMaxLength(31)),

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
                    return interaction.editReply(noticePayload(
                        'Hashtag must start with #gc and be 3-30 characters: letters, digits, or underscore. Example: #gcskyballers',
                        { title: 'Invalid Hashtag', subtitle: SUB }
                    ));
                }
                hashtag = normalizeHashtag(rawHashtag);
            }

            const owned = await fetchLeaguesByOwner(interaction.user.id);
            const coowned = await fetchLeaguesByCoOwner(interaction.user.id);
            const league = [...owned, ...coowned][0] || null;
            if (!league) {
                return interaction.editReply(noticePayload('You do not own or co-own a registered league.', { title: 'No League Found', subtitle: SUB }));
            }
            // Co-owners may set the content hashtag; sport stays owner-only.
            if (sport && owned.length === 0) {
                return interaction.editReply(noticePayload('Only the league owner can change the sport.', { title: 'Owner Only', subtitle: SUB }));
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
