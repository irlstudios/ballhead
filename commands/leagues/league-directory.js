'use strict';

const { SlashCommandBuilder } = require('discord.js');
const logger = require('../../utils/logger');
const { noticePayload } = require('../../utils/ui');
const { fetchLeaguesForDirectory } = require('../../db');
const { buildDirectoryLines } = require('../../utils/league_directory');

const SUB = 'League Directory';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('league-directory')
        .setDescription('Browse the registered leagues (Sponsored, Active, Base)'),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const leagues = await fetchLeaguesForDirectory();
            return interaction.editReply(noticePayload(buildDirectoryLines(leagues), { title: 'League Directory', subtitle: SUB }));
        } catch (error) {
            logger.error('[Directory] league-directory failed:', error);
            return interaction.editReply(noticePayload('An error occurred while loading the directory.', { title: 'Directory Error', subtitle: SUB }));
        }
    },
};
