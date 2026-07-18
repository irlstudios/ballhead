'use strict';

const { SlashCommandBuilder } = require('discord.js');
const logger = require('../../utils/logger');
const { noticePayload } = require('../../utils/ui');
const {
    fetchLeaguesByOwner,
    fetchLeaguesByCoOwner,
    countActiveStrikes,
    countRewardRequestsThisMonth,
    insertRewardRequest,
    setRewardOpsMessage,
    deleteRewardRequest,
} = require('../../db');
const { rewardRequestEligibility } = require('../../utils/league_rewards');
const { postRewardCard } = require('../../handlers/league-rewards');

const SUB = 'Request Reward';

function currentMonth() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('request-reward')
        .setDescription('Request a reward or cosmetic for your Sponsored league')
        .addStringOption((o) => o.setName('reward').setDescription('What you are requesting').setRequired(true).setMaxLength(120))
        .addStringOption((o) => o.setName('details').setDescription('Context / justification').setRequired(false).setMaxLength(400)),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const userId = interaction.user.id;
            const owned = await fetchLeaguesByOwner(userId);
            const coowned = await fetchLeaguesByCoOwner(userId);
            const all = [...owned, ...coowned];
            const league = all.find((l) => l.league_type === 'Sponsored' && l.league_status === 'Active') || all[0] || null;

            // ponytail: monthly cap is a soft, non-atomic limit; a rare concurrent
            // burst may exceed it slightly. Acceptable for a courtesy cap.
            let activeStrikes = 0;
            let monthCount = 0;
            if (league) {
                activeStrikes = await countActiveStrikes(league.league_id);
                monthCount = await countRewardRequestsThisMonth(league.league_id, currentMonth());
            }

            const gate = rewardRequestEligibility(league, { activeStrikes, monthCount });
            if (!gate.ok) {
                return interaction.editReply(noticePayload(gate.message, { title: gate.title, subtitle: SUB }));
            }

            const request = await insertRewardRequest({
                leagueId: league.league_id,
                requestedBy: userId,
                rewardType: interaction.options.getString('reward'),
                details: interaction.options.getString('details'),
            });

            try {
                const message = await postRewardCard(interaction.client, request, league.league_name);
                await setRewardOpsMessage(request.id, message.id);
            } catch (postErr) {
                await deleteRewardRequest(request.id).catch(() => {});
                throw postErr;
            }

            logger.info(`[Rewards] Request ${request.id} created by ${userId} for league ${league.league_id}`);
            return interaction.editReply(noticePayload(
                [`Your reward request (**#${request.id}**) was submitted for staff review.`, 'You will be DMed with the decision and when it is fulfilled.'],
                { title: 'Reward Requested', subtitle: SUB }
            ));
        } catch (error) {
            logger.error('[Rewards] request-reward failed:', error);
            return interaction.editReply(noticePayload('An error occurred while creating your reward request.', { title: 'Request Failed', subtitle: SUB }));
        }
    },
};
