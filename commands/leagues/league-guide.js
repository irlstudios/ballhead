'use strict';

const { SlashCommandBuilder } = require('discord.js');
const logger = require('../../utils/logger');
const { noticePayload } = require('../../utils/ui');
const { buildLeagueGuidePayload } = require('../../utils/league_guide');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('league-guide')
        .setDescription('The League Owner Guide: how to run, grow, and level up your league'),

    async execute(interaction) {
        try {
            await interaction.reply({ ...buildLeagueGuidePayload(), ephemeral: true });
        } catch (error) {
            logger.error('[League Guide] Error:', error);
            await interaction.reply({
                ...noticePayload('Could not load the guide. Please try again later.', {
                    title: 'Guide Unavailable',
                    subtitle: 'League Guide',
                }),
                ephemeral: true,
            }).catch(err => logger.error('[League Guide] Failed to reply:', err));
        }
    },
};
