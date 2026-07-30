'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, PermissionsBitField } = require('discord.js');
const logger = require('../../utils/logger');
const { noticePayload } = require('../../utils/ui');
const { fetchLeagueOverviewStats } = require('../../db');
const { buildOverviewLines, chunkLines } = require('../../utils/league_games');

const SUB = 'League Overview';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('league-overview')
        .setDescription('All leagues with hashtag and weekly player activity (staff)')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

    async execute(interaction) {
        // setDefaultMemberPermissions gates the command; re-check here because
        // server admins can override command permissions per-role in Discord.
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
            return interaction.reply({
                ...noticePayload('You do not have permission to view the league overview.', { title: 'Permission Denied', subtitle: SUB }),
                ephemeral: true,
            });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const leagues = await fetchLeagueOverviewStats();
            // Chunked so a long league list stays under Discord's 4000-char
            // text display limit; extra chunks go out as follow-ups.
            const chunks = chunkLines(buildOverviewLines(leagues));
            await interaction.editReply(noticePayload(
                chunks[0],
                { title: `League Overview (${leagues.length})`, subtitle: SUB }
            ));
            for (const chunk of chunks.slice(1)) {
                await interaction.followUp({ ...noticePayload(chunk, { subtitle: SUB }), ephemeral: true });
            }
            return undefined;
        } catch (error) {
            logger.error('[Games] league-overview failed:', error);
            return interaction.editReply(noticePayload('An error occurred while loading the overview.', { title: 'Overview Error', subtitle: SUB }));
        }
    },
};
