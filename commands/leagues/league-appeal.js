'use strict';

const { SlashCommandBuilder } = require('discord.js');
const logger = require('../../utils/logger');
const { noticePayload } = require('../../utils/ui');
const {
    fetchLeaguesByOwner,
    fetchLeaguesByCoOwner,
    fetchStrikeById,
    hasPendingAppealForStrike,
    insertAppeal,
    setAppealOpsMessage,
    deleteAppeal,
} = require('../../db');
const { appealEligibility } = require('../../utils/league_enforcement');
const { postAppealCard } = require('../../handlers/league-appeals');

const SUB = 'League Appeal';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('league-appeal')
        .setDescription('Appeal an active strike against your league')
        .addIntegerOption((o) => o.setName('strike').setDescription('Strike id (see the strike DM)').setRequired(true))
        .addStringOption((o) => o.setName('statement').setDescription('Why the strike should be lifted').setRequired(true).setMaxLength(600)),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const userId = interaction.user.id;
            const owned = await fetchLeaguesByOwner(userId);
            const coowned = await fetchLeaguesByCoOwner(userId);
            const leagues = [...owned, ...coowned];
            if (leagues.length === 0) {
                return interaction.editReply(noticePayload('You do not own or co-own a registered league.', { title: 'No League Found', subtitle: SUB }));
            }
            const leagueIds = new Set(leagues.map((l) => l.league_id));

            const strikeId = interaction.options.getInteger('strike');
            const strike = await fetchStrikeById(strikeId);

            // The strike must belong to one of the caller's leagues.
            const strikeIsYours = strike && leagueIds.has(strike.league_id);
            const hasPendingAppeal = strikeIsYours ? await hasPendingAppealForStrike(strikeId) : false;
            const gate = appealEligibility(strikeIsYours ? strike : null, { hasPendingAppeal });
            if (!gate.ok) {
                return interaction.editReply(noticePayload(gate.message, { title: gate.title, subtitle: SUB }));
            }

            const league = leagues.find((l) => l.league_id === strike.league_id);
            const statement = interaction.options.getString('statement');

            let appeal;
            try {
                appeal = await insertAppeal({ strikeId, leagueId: strike.league_id, submittedBy: userId, statement });
            } catch (insErr) {
                // Unique-index backstop for a concurrent double-submit.
                if (insErr.code === '23505') {
                    return interaction.editReply(noticePayload('An appeal for this strike is already awaiting review.', { title: 'Appeal Pending', subtitle: SUB }));
                }
                throw insErr;
            }

            try {
                const message = await postAppealCard(interaction.client, appeal, { leagueName: league.league_name, strikeReason: strike.reason });
                await setAppealOpsMessage(appeal.id, message.id);
            } catch (postErr) {
                await deleteAppeal(appeal.id).catch(() => {});
                throw postErr;
            }

            logger.info(`[Appeals] Appeal ${appeal.id} submitted by ${userId} for strike ${strikeId}`);
            return interaction.editReply(noticePayload(
                [`Your appeal (**#${appeal.id}**) for strike #${strikeId} has been submitted for staff review.`, 'You will be DMed with the decision.'],
                { title: 'Appeal Submitted', subtitle: SUB }
            ));
        } catch (error) {
            logger.error('[Appeals] league-appeal failed:', error);
            return interaction.editReply(noticePayload('An error occurred while submitting your appeal.', { title: 'Appeal Failed', subtitle: SUB }));
        }
    },
};
