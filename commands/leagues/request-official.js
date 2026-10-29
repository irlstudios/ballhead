'use strict';

const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const logger = require('../../utils/logger');
const { noticePayload } = require('../../utils/ui');
const {
    fetchLeaguesByOwner,
    fetchLeaguesByCoOwner,
    fetchCheckinForMonth,
    countOpenOfficialRequests,
    insertOfficialRequest,
    setOfficialRequestOpsMessage,
    deleteOfficialRequest,
} = require('../../db');
const {
    ELIGIBLE_TIERS,
    officialRequestEligibility,
    atOpenRequestCap,
} = require('../../utils/league_officials');
const { postOfficialRequestCard } = require('../../handlers/league-officials');

const SUB = 'Request Official';

// UTC, matching every other check-in month computation, so a host timezone
// change can never split one month into two.
function currentMonth() {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Prefer an already-eligible league, otherwise the first owned/co-owned one
// so the eligibility gate can explain why it is blocked.
async function resolveCallerLeague(userId) {
    const owned = await fetchLeaguesByOwner(userId);
    const coowned = await fetchLeaguesByCoOwner(userId);
    const all = [...owned, ...coowned];
    return all.find((l) => ELIGIBLE_TIERS.includes(l.league_type) && l.league_status === 'Active') || all[0] || null;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('league-request-official')
        .setDescription('Request a community official for a league game (Active/Sponsored)')
        .addStringOption((o) => o.setName('sport').setDescription('Sport / format for the match').setRequired(true).setMaxLength(60))
        .addStringOption((o) => o.setName('details').setDescription('Opponent, event, or match context').setRequired(true).setMaxLength(300))
        .addStringOption((o) => o.setName('when').setDescription('Proposed date / time').setRequired(false).setMaxLength(120)),

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const userId = interaction.user.id;
            const league = await resolveCallerLeague(userId);

            let hasCurrentCheckin = false;
            if (league) {
                const checkins = await fetchCheckinForMonth(league.league_id, currentMonth());
                hasCurrentCheckin = checkins.length > 0;
            }

            const gate = officialRequestEligibility(league, { hasCurrentCheckin });
            if (!gate.ok) {
                return interaction.editReply(noticePayload(gate.message, { title: gate.title, subtitle: SUB }));
            }

            // ponytail: soft anti-spam cap, checked non-atomically. A rare
            // concurrent burst may exceed it by a few; acceptable for a spam gate.
            const openCount = await countOpenOfficialRequests(league.league_id);
            if (atOpenRequestCap(openCount)) {
                return interaction.editReply(noticePayload(
                    `Your league already has ${openCount} open requests (the max). Wait for one to be assigned or completed first.`,
                    { title: 'Too Many Open Requests', subtitle: SUB }
                ));
            }

            const request = await insertOfficialRequest({
                leagueId: league.league_id,
                requestedBy: userId,
                sport: interaction.options.getString('sport'),
                matchDetails: interaction.options.getString('details'),
                proposedTime: interaction.options.getString('when'),
            });

            try {
                const message = await postOfficialRequestCard(interaction.client, request, league.league_name);
                await setOfficialRequestOpsMessage(request.id, message.id);
            } catch (postErr) {
                // Roll back the orphan so it does not silently consume the cap.
                await deleteOfficialRequest(request.id).catch(() => {});
                throw postErr;
            }

            logger.info(`[Officials] Request ${request.id} created by ${userId} for league ${league.league_id}`);
            // Self-service undo: the button routes to handleRequesterCancel
            // (handlers/league-officials.js), which only lets the original
            // requester withdraw the request while it is still Pending.
            const confirmation = noticePayload(
                [
                    `Your request (**#${request.id}**) has been posted for staff to assign an official.`,
                    'You will be DMed when it is assigned and again when the game is verified.',
                    'Made a mistake? Cancel below while the request is still pending.',
                ],
                { title: 'Official Requested', subtitle: SUB }
            );
            const cancelRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`official:cancel:${request.id}`).setLabel('Cancel Request').setStyle(ButtonStyle.Danger),
            );
            return interaction.editReply({ ...confirmation, components: [...confirmation.components, cancelRow] });
        } catch (error) {
            logger.error('[Officials] request-official failed:', error);
            return interaction.editReply(noticePayload('An error occurred while creating your request.', { title: 'Request Failed', subtitle: SUB }));
        }
    },
};
