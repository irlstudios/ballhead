'use strict';

const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    MessageFlags,
    ContainerBuilder,
    PermissionsBitField,
} = require('discord.js');
const logger = require('../utils/logger');
const { buildTextBlock, noticePayload } = require('../utils/ui');
const {
    fetchLeaguesByOwner,
    fetchLeaguesByCoOwner,
    fetchLeagueById,
    insertOfficialRequest,
    fetchOfficialRequest,
    setOfficialRequestMessageId,
    assignOfficialsToRequest,
    denyOfficialRequest,
    completeOfficialRequest,
    countOpenRequestsForLeague,
    fetchAvailableOfficials,
    insertGameReport,
    insertLeagueGame,
    countVerifiedGames,
} = require('../db');
const { LEAGUE_OFFICIALS_CHANNEL_ID } = require('../config/constants');
const {
    officialRequestEligibility,
    requestPriority,
    mapAssignedOfficials,
    canSubmitReport,
    isValidHttpUrl,
    buildVerifiedGameRecord,
} = require('../utils/league_officials');

const MAX_SELECT_OPTIONS = 25;
// Leagues run many games, so multiple concurrent requests are legitimate; this
// only stops runaway spam of un-actioned requests.
const MAX_OPEN_REQUESTS_PER_LEAGUE = 5;

const staffCanManage = (interaction) =>
    interaction.member.permissions.has(PermissionsBitField.Flags.ManageRoles);

const permissionDenied = (interaction, message) =>
    interaction.reply({
        ...noticePayload(message, { title: 'Permission Denied', subtitle: 'Officials' }),
        ephemeral: true,
    });

// Resolve the single league the caller owns or co-owns (first match, matching
// the /add-co-owner convention). Returns null when they run none.
const resolveCallerLeague = async (userId) => {
    const owned = await fetchLeaguesByOwner(userId);
    if (owned.length > 0) return owned[0];
    const coOwned = await fetchLeaguesByCoOwner(userId);
    return coOwned[0] || null;
};

// Fetch and edit the ops-channel card for a request. No-op if the card is gone.
const updateOpsCard = async (client, request, { title, subtitle, lines }) => {
    if (!request.ops_message_id) return;
    try {
        const channel = await client.channels.fetch(LEAGUE_OFFICIALS_CHANNEL_ID);
        const message = await channel.messages.fetch(request.ops_message_id);
        const container = new ContainerBuilder();
        const block = buildTextBlock({ title, subtitle, lines });
        if (block) container.addTextDisplayComponents(block);
        await message.edit({ flags: MessageFlags.IsComponentsV2, components: [container] });
    } catch (error) {
        logger.error(`[Officials] Failed to update ops card for request ${request.request_id}:`, error.message);
    }
};

// --- Step 1: league requests an official ------------------------------------

const handleRequestOfficialModal = async (interaction) => {
    await interaction.deferReply({ ephemeral: true });

    try {
        const userId = interaction.user.id;
        const league = await resolveCallerLeague(userId);
        if (!league) {
            return interaction.editReply(
                noticePayload('You do not own or co-own a registered league.', { title: 'No League Found', subtitle: 'Request Official' })
            );
        }

        const eligibility = officialRequestEligibility({
            leagueType: league.league_type,
            leagueStatus: league.league_status,
        });
        if (!eligibility.ok) {
            return interaction.editReply(
                noticePayload(eligibility.reason, { title: 'Not Eligible', subtitle: 'Request Official' })
            );
        }

        const openCount = await countOpenRequestsForLeague(league.league_id);
        if (openCount >= MAX_OPEN_REQUESTS_PER_LEAGUE) {
            return interaction.editReply(
                noticePayload(
                    `Your league already has ${openCount} open official requests (max ${MAX_OPEN_REQUESTS_PER_LEAGUE}). Wait for staff to action them first.`,
                    { title: 'Too Many Open Requests', subtitle: 'Request Official' }
                )
            );
        }

        const sport = interaction.fields.getTextInputValue('sport');
        const gameMode = interaction.fields.getTextInputValue('game-mode');
        const scheduledAt = interaction.fields.getTextInputValue('scheduled-at');
        const rulesDoc = interaction.fields.getTextInputValue('rules-doc') || null;

        if (rulesDoc && !isValidHttpUrl(rulesDoc)) {
            return interaction.editReply(
                noticePayload('The rules document must be a valid http(s) link, or left blank.', { title: 'Invalid Rules Link', subtitle: 'Request Official' })
            );
        }

        const parsedNeeded = parseInt(interaction.fields.getTextInputValue('officials-needed'), 10);
        const officialsRequested = Number.isNaN(parsedNeeded) ? 1 : Math.min(3, Math.max(1, parsedNeeded));

        const request = await insertOfficialRequest({
            leagueId: league.league_id,
            requestedBy: userId,
            sport,
            gameMode,
            scheduledAt,
            officialsRequested,
            rulesDocumentUrl: rulesDoc,
            leagueInvite: league.league_invite || null,
        });

        const priority = requestPriority(league.league_type);
        const container = new ContainerBuilder();
        const block = buildTextBlock({
            title: `Official Request - ${priority} Priority`,
            subtitle: league.league_name,
            lines: [
                `**Request ID:** ${request.request_id}`,
                `**Tier:** ${league.league_type}`,
                `**Requested by:** <@${userId}>`,
                `**Sport:** ${sport}`,
                `**Mode:** ${gameMode}`,
                `**When:** ${scheduledAt}`,
                `**Officials needed:** ${officialsRequested}`,
                league.league_invite ? `**Invite:** ${league.league_invite}` : null,
                rulesDoc ? `**Rules:** ${rulesDoc}` : null,
            ],
        });
        if (block) container.addTextDisplayComponents(block);

        const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`assignOfficial_${request.request_id}`).setLabel('Assign Officials').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`denyOfficial_${request.request_id}`).setLabel('Deny').setStyle(ButtonStyle.Danger),
        );

        const opsChannel = await interaction.client.channels.fetch(LEAGUE_OFFICIALS_CHANNEL_ID);
        const opsMessage = await opsChannel.send({ flags: MessageFlags.IsComponentsV2, components: [container, buttons] });
        await setOfficialRequestMessageId(request.request_id, opsMessage.id);

        logger.info(`[Officials] Request ${request.request_id} created by ${userId} for league ${league.league_id} (${sport}).`);

        return interaction.editReply(
            noticePayload(
                `Your request (ID ${request.request_id}) has been submitted. Staff will assign officials shortly.`,
                { title: 'Request Submitted', subtitle: league.league_name }
            )
        );
    } catch (error) {
        logger.error('[Officials] Error in handleRequestOfficialModal:', error);
        return interaction.editReply(
            noticePayload('An error occurred while submitting your request.', { title: 'Request Failed', subtitle: 'Request Official' })
        );
    }
};

// --- Step 2: staff assigns officials ----------------------------------------

const handleAssignOfficialButton = async (interaction) => {
    if (!staffCanManage(interaction)) {
        return permissionDenied(interaction, 'You do not have permission to assign officials.');
    }

    const requestId = interaction.customId.split('_')[1];
    const request = await fetchOfficialRequest(requestId);
    if (!request || !['Pending', 'Approved'].includes(request.status)) {
        return interaction.reply({
            ...noticePayload('This request is no longer open for assignment.', { title: 'Unavailable', subtitle: 'Officials' }),
            ephemeral: true,
        });
    }

    // Re-check the league is still eligible at assignment time (it may have gone
    // inactive or disbanded since the request was created).
    const league = await fetchLeagueById(request.league_id);
    const eligibility = officialRequestEligibility({
        leagueType: league?.league_type,
        leagueStatus: league?.league_status,
    });
    if (!league || !eligibility.ok) {
        return interaction.reply({
            ...noticePayload(`This league is no longer eligible: ${eligibility.reason || 'league not found'}`, { title: 'League Ineligible', subtitle: 'Officials' }),
            ephemeral: true,
        });
    }

    const available = await fetchAvailableOfficials(request.sport);
    if (available.length === 0) {
        return interaction.reply({
            ...noticePayload(`No available roster officials cover **${request.sport}**. Add officials with \`/official-roster add\`.`, { title: 'No Officials Available', subtitle: 'Officials' }),
            ephemeral: true,
        });
    }

    const options = available.slice(0, MAX_SELECT_OPTIONS).map((official) => ({
        label: (official.discord_username || official.official_id.toString()).slice(0, 100),
        description: [official.tier, official.sports].filter(Boolean).join(' - ').slice(0, 100) || undefined,
        value: official.official_id.toString(),
    }));

    const maxPick = Math.min(3, request.officials_requested, options.length);
    const select = new StringSelectMenuBuilder()
        .setCustomId(`assignOfficialSelect:${requestId}`)
        .setPlaceholder(`Select up to ${maxPick} official(s)`)
        .setMinValues(1)
        .setMaxValues(maxPick)
        .addOptions(options);

    return interaction.reply({
        content: `Assigning officials for request ${requestId} (${request.sport}).`,
        components: [new ActionRowBuilder().addComponents(select)],
        ephemeral: true,
    });
};

const dmAssignedOfficial = async (client, officialId, request) => {
    try {
        const user = await client.users.fetch(officialId.toString());
        const container = new ContainerBuilder();
        const block = buildTextBlock({
            title: 'You have been assigned to a league game',
            subtitle: `Request ${request.request_id}`,
            lines: [
                `**Sport:** ${request.sport}`,
                `**Mode:** ${request.game_mode}`,
                `**When:** ${request.scheduled_at}`,
                request.league_invite ? `**League invite:** ${request.league_invite}` : null,
                request.rules_document_url ? `**Rules:** ${request.rules_document_url}` : null,
                '',
                'After the match, press the button below to submit your report.',
            ],
        });
        if (block) container.addTextDisplayComponents(block);
        const button = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`submitGameReport_${request.request_id}`).setLabel('Submit Report').setStyle(ButtonStyle.Primary),
        );
        await user.send({ flags: MessageFlags.IsComponentsV2, components: [container, button] });
    } catch (error) {
        logger.error(`[Officials] Failed to DM assigned official ${officialId}:`, error.message);
    }
};

const handleAssignOfficialSelect = async (interaction) => {
    if (!staffCanManage(interaction)) {
        return permissionDenied(interaction, 'You do not have permission to assign officials.');
    }

    await interaction.deferUpdate();

    const requestId = interaction.customId.split(':')[1];
    const selectedIds = interaction.values;

    // Atomic claim: only the first staffer to assign wins; a concurrent assign
    // gets false and is told the request was already handled.
    const won = await assignOfficialsToRequest(requestId, mapAssignedOfficials(selectedIds));
    if (!won) {
        return interaction.editReply({
            content: `Request ${requestId} was already assigned or closed by someone else.`,
            components: [],
        });
    }

    const updated = await fetchOfficialRequest(requestId);
    await updateOpsCard(interaction.client, updated, {
        title: 'Official Request - Assigned',
        subtitle: `Request ${requestId}`,
        lines: [
            `**Sport:** ${updated.sport}`,
            `**When:** ${updated.scheduled_at}`,
            `**Assigned:** ${selectedIds.map((id) => `<@${id}>`).join(', ')}`,
            `**Assigned by:** <@${interaction.user.id}>`,
        ],
    });

    for (const officialId of selectedIds) {
        await dmAssignedOfficial(interaction.client, officialId, updated);
    }

    logger.info(`[Officials] Request ${requestId} assigned to [${selectedIds.join(', ')}] by ${interaction.user.id}.`);

    return interaction.editReply({
        content: `Assigned ${selectedIds.length} official(s) to request ${requestId}. They have been notified.`,
        components: [],
    });
};

const handleDenyOfficialButton = async (interaction) => {
    if (!staffCanManage(interaction)) {
        return permissionDenied(interaction, 'You do not have permission to deny requests.');
    }

    const requestId = interaction.customId.split('_')[1];
    const request = await fetchOfficialRequest(requestId);
    if (!request) {
        return interaction.reply({
            ...noticePayload('Request not found.', { title: 'Not Found', subtitle: 'Officials' }),
            ephemeral: true,
        });
    }

    const denied = await denyOfficialRequest(requestId);
    if (!denied) {
        return interaction.reply({
            ...noticePayload('This request was already assigned or closed and cannot be denied.', { title: 'Unavailable', subtitle: 'Officials' }),
            ephemeral: true,
        });
    }

    await updateOpsCard(interaction.client, request, {
        title: 'Official Request - Denied',
        subtitle: `Request ${requestId}`,
        lines: [`**Denied by:** <@${interaction.user.id}>`],
    });

    try {
        const requester = await interaction.client.users.fetch(request.requested_by.toString());
        await requester.send(
            `Your official request (ID ${request.request_id}) for a ${request.sport} game was not approved. ` +
            'Reach out to staff in the league channels if you have questions.'
        ).catch(() => {});
    } catch (error) {
        logger.error(`[Officials] Failed to DM requester ${request.requested_by}:`, error.message);
    }

    logger.info(`[Officials] Request ${requestId} denied by ${interaction.user.id}.`);

    return interaction.reply({
        ...noticePayload(`Request ${requestId} denied.`, { title: 'Request Denied', subtitle: 'Officials' }),
        ephemeral: true,
    });
};

// --- Step 3-5: official submits report -> verified game ----------------------

const handleSubmitGameReportButton = async (interaction) => {
    const requestId = interaction.customId.split('_')[1];
    const request = await fetchOfficialRequest(requestId);
    const check = canSubmitReport(request, interaction.user.id);
    if (!check.ok) {
        return interaction.reply({
            ...noticePayload(check.reason, { title: 'Cannot Submit Report', subtitle: 'Game Report' }),
            ephemeral: true,
        });
    }

    const { createModal } = require('../modals/modalFactory');
    const modal = createModal('game-report-modal');
    if (!modal) {
        return interaction.reply({
            ...noticePayload('Report form unavailable. Try again shortly.', { title: 'Form Unavailable', subtitle: 'Game Report' }),
            ephemeral: true,
        });
    }
    modal.setCustomId(`game-report-modal:${requestId}`);
    return interaction.showModal(modal);
};

const handleGameReportModal = async (interaction) => {
    await interaction.deferReply({ ephemeral: true });

    try {
        const requestId = interaction.customId.split(':')[1];
        const request = await fetchOfficialRequest(requestId);

        const check = canSubmitReport(request, interaction.user.id);
        if (!check.ok) {
            return interaction.editReply(
                noticePayload(check.reason, { title: 'Cannot Submit Report', subtitle: 'Game Report' })
            );
        }

        const finalScore = interaction.fields.getTextInputValue('final-score');
        const winningTeam = interaction.fields.getTextInputValue('winning-team');
        const proofUrl = interaction.fields.getTextInputValue('proof-url');
        const issuesNotes = interaction.fields.getTextInputValue('issues-notes') || null;
        const parsedPlayers = parseInt(interaction.fields.getTextInputValue('player-count'), 10);
        const playerCount = Number.isNaN(parsedPlayers) ? null : parsedPlayers;

        if (!isValidHttpUrl(proofUrl)) {
            return interaction.editReply(
                noticePayload('Proof must be a valid http(s) link (VOD or screenshot URL).', { title: 'Invalid Proof Link', subtitle: 'Game Report' })
            );
        }

        // Atomic completion claim BEFORE writing any records. If a second
        // submission (double-click or second assigned official) races in, this
        // returns false and we abort with no duplicate game recorded.
        const claimed = await completeOfficialRequest(requestId);
        if (!claimed) {
            return interaction.editReply(
                noticePayload('This request has already been reported or closed.', { title: 'Already Reported', subtitle: 'Game Report' })
            );
        }

        await insertGameReport({
            requestId: request.request_id,
            leagueId: request.league_id,
            officialId: interaction.user.id,
            finalScore,
            winningTeam,
            playerCount,
            sportsmanshipNotes: issuesNotes,
            proofUrl,
        });

        const record = buildVerifiedGameRecord({
            request,
            report: {
                final_score: finalScore,
                winning_team: winningTeam,
                player_count: playerCount,
                proof_url: proofUrl,
                sportsmanship_notes: issuesNotes,
            },
            officialId: interaction.user.id,
        });
        await insertLeagueGame(record);

        const verifiedCount = await countVerifiedGames(request.league_id);

        await updateOpsCard(interaction.client, request, {
            title: 'Official Request - Completed',
            subtitle: `Request ${requestId}`,
            lines: [
                `**Sport:** ${request.sport}`,
                `**Final score:** ${finalScore}`,
                `**Winner:** ${winningTeam}`,
                `**Reported by:** <@${interaction.user.id}>`,
                `**League verified games:** ${verifiedCount}`,
            ],
        });

        // Notify the league owner that a verified game landed.
        try {
            const league = await fetchLeagueById(request.league_id);
            if (league) {
                const owner = await interaction.client.users.fetch(league.owner_id.toString());
                await owner.send(
                    `A game for **${league.league_name}** was verified by an official (${finalScore}, winner: ${winningTeam}). ` +
                    `Your league now has **${verifiedCount}** verified game(s).`
                ).catch(() => {});
            }
        } catch (error) {
            logger.error(`[Officials] Failed to notify league owner for request ${requestId}:`, error.message);
        }

        logger.info(`[Officials] Request ${requestId} completed by ${interaction.user.id}; league ${request.league_id} now has ${verifiedCount} verified game(s).`);

        return interaction.editReply(
            noticePayload(
                `Report recorded. This game is now Official Verified. The league has ${verifiedCount} verified game(s).`,
                { title: 'Report Submitted', subtitle: `Request ${requestId}` }
            )
        );
    } catch (error) {
        logger.error('[Officials] Error in handleGameReportModal:', error);
        return interaction.editReply(
            noticePayload('An error occurred while submitting your report.', { title: 'Report Failed', subtitle: 'Game Report' })
        );
    }
};

module.exports = {
    handleRequestOfficialModal,
    handleAssignOfficialButton,
    handleAssignOfficialSelect,
    handleDenyOfficialButton,
    handleSubmitGameReportButton,
    handleGameReportModal,
};
