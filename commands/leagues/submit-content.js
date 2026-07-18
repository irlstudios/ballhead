'use strict';

const { SlashCommandBuilder } = require('discord.js');
const logger = require('../../utils/logger');
const { noticePayload } = require('../../utils/ui');
const { fetchLeaguesByOwner, fetchLeaguesByCoOwner, insertContentSubmission } = require('../../db');
const { ELIGIBLE_TIERS } = require('../../utils/league_officials');
const { contentSubmissionEligibility, isValidContentUrl } = require('../../utils/league_content');

const SUB = 'Submit Content';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('submit-content')
        .setDescription('Submit a content post for your league (Active/Sponsored)')
        .addStringOption((o) => o.setName('url').setDescription('Link to the content').setRequired(true).setMaxLength(300))
        .addStringOption((o) => o.setName('platform').setDescription('YouTube, TikTok, X, etc.').setRequired(false).setMaxLength(40))
        .addStringOption((o) => o.setName('title').setDescription('Short title / description').setRequired(false).setMaxLength(200)),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const userId = interaction.user.id;
            const owned = await fetchLeaguesByOwner(userId);
            const coowned = await fetchLeaguesByCoOwner(userId);
            const all = [...owned, ...coowned];
            const league = all.find((l) => ELIGIBLE_TIERS.includes(l.league_type) && l.league_status === 'Active') || all[0] || null;

            const gate = contentSubmissionEligibility(league);
            if (!gate.ok) {
                return interaction.editReply(noticePayload(gate.message, { title: gate.title, subtitle: SUB }));
            }

            const url = interaction.options.getString('url').trim();
            if (!isValidContentUrl(url)) {
                return interaction.editReply(noticePayload('Provide a valid http(s) content link.', { title: 'Invalid Link', subtitle: SUB }));
            }

            const submission = await insertContentSubmission({
                leagueId: league.league_id,
                submittedBy: userId,
                url,
                platform: interaction.options.getString('platform'),
                title: interaction.options.getString('title'),
            });

            logger.info(`[Content] Submission ${submission.id} by ${userId} for league ${league.league_id}`);
            return interaction.editReply(noticePayload(
                ['Content submitted. View totals will be tracked over time.', 'Content is verified manually by staff.'],
                { title: 'Content Submitted', subtitle: league.league_name }
            ));
        } catch (error) {
            logger.error('[Content] submit-content failed:', error);
            return interaction.editReply(noticePayload('An error occurred while submitting content.', { title: 'Submission Error', subtitle: SUB }));
        }
    },
};
