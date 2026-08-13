'use strict';

const { SlashCommandBuilder } = require('discord.js');
const logger = require('../../utils/logger');
const { noticePayload } = require('../../utils/ui');
const { fetchLeaguesForDirectory } = require('../../db');
const { buildDirectoryLines } = require('../../utils/league_directory');
const { chunkLines } = require('../../utils/league_games');

const SUB = 'League Directory';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('league-directory')
        .setDescription('Browse the registered leagues (Sponsored, Active, Base)'),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const leagues = await fetchLeaguesForDirectory();
            // Chunked so a long directory stays under Discord's 4000-char text
            // display limit; extra chunks go out as follow-ups (as /league overview does).
            const chunks = chunkLines(buildDirectoryLines(leagues));
            await interaction.editReply(noticePayload(chunks[0], { title: 'League Directory', subtitle: SUB }));
            for (const chunk of chunks.slice(1)) {
                await interaction.followUp({ ...noticePayload(chunk, { subtitle: SUB }), ephemeral: true });
            }
            return undefined;
        } catch (error) {
            logger.error('[Directory] league-directory failed:', error);
            return interaction.editReply(noticePayload('An error occurred while loading the directory.', { title: 'Directory Error', subtitle: SUB }));
        }
    },
};
