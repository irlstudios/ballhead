'use strict';

const { MessageFlags, ContainerBuilder, PermissionsBitField } = require('discord.js');
const logger = require('../utils/logger');
const { buildTextBlock, noticePayload } = require('../utils/ui');
const { setReportStatus, fetchReportByRefId, fetchQueueReports } = require('../utils/reports_queries');
const { sortByPriority, STATUS_LABEL } = require('../utils/reports_logic');
const { buildQueueCard } = require('../utils/reports_view');

// Approve, deny and needs-info differed only in their copy, so they are data now.
// The forum buttons and the /reports queue buttons both drive the same path,
// which is the point: two surfaces that action reports cannot drift apart.
const OUTCOMES = {
    approved: {
        status: 'approved',
        threadTitle: 'Report Approved',
        threadLine: (moderator) => `This report has been approved by <@${moderator}>.`,
        dmTitle: 'Report Approved',
        dmLines: [
            'Your report has been approved.',
            'Thank you for helping keep the community safe.',
            'Appropriate action (such as a ban or moderation review) will be handled swiftly.',
        ],
        confirmation: 'The report has been approved.',
    },
    denied: {
        status: 'denied',
        threadTitle: 'Report Denied',
        threadLine: (moderator) => `This report has been denied by <@${moderator}>.`,
        dmTitle: 'Report Denied',
        dmLines: [
            'Your report has been denied.',
            'It did not meet our current moderation guidelines or lacked sufficient evidence.',
        ],
        confirmation: 'The report has been denied.',
    },
    needs_info: {
        status: 'needs_info',
        threadTitle: 'More Information Requested',
        threadLine: (moderator) => `More information requested by <@${moderator}>.`,
        dmTitle: 'More Information Needed',
        dmLines: [
            'Your report requires additional information.',
            'Please head to <#1525522211753037824> and select the **Ban Discussion** dropdown option so our team can follow up and gather more details.',
        ],
        confirmation: 'The reporter has been asked for more information.',
    },
};

const canActionReports = (interaction) =>
    Boolean(interaction.member?.permissions?.has(PermissionsBitField.Flags.ManageRoles));

const extractRefId = (channel) => {
    const match = (channel?.name || '').match(/RPT-[A-F0-9]{6}/);
    return match ? match[0] : null;
};

const extractReportedUser = (channel) => {
    const match = (channel?.name || '').match(/Report:\s*(.+)$/i);
    return match ? match[1].trim() : null;
};

const sendOutcomeDm = async (interaction, outcome, { reporterId, refId, reportedName }) => {
    if (!reporterId) {
        return;
    }
    try {
        const member = await interaction.guild.members.fetch(reporterId);
        const container = new ContainerBuilder();
        const block = buildTextBlock({
            title: outcome.dmTitle,
            subtitle: refId || 'Player Report',
            lines: [
                reportedName ? `**Reported Player:** ${reportedName}` : null,
                '',
                ...outcome.dmLines,
            ],
        });
        if (block) container.addTextDisplayComponents(block);
        await member.send({ flags: MessageFlags.IsComponentsV2, components: [container] });
    } catch (dmError) {
        logger.error(`Failed to DM reporter about ${refId}:`, dmError.message);
    }
};

// Appends the outcome to the forum post and drops the action row, so a report
// cannot be actioned twice from the thread.
const stampThreadMessage = async (message, outcome, moderatorId, refId) => {
    if (!message) {
        return;
    }
    try {
        const existing = message.components.filter((c) => c.type !== 1).map((c) => c.toJSON());
        const container = new ContainerBuilder();
        const block = buildTextBlock({
            title: outcome.threadTitle,
            subtitle: refId || 'Player Report',
            lines: [outcome.threadLine(moderatorId)],
        });
        if (block) container.addTextDisplayComponents(block);
        await message.edit({ flags: MessageFlags.IsComponentsV2, components: [...existing, container] });
    } catch (editError) {
        logger.error(`Failed to stamp report thread for ${refId}:`, editError.message);
    }
};

const resolveThreadMessage = async (interaction, threadId) => {
    if (!threadId) {
        return null;
    }
    try {
        const thread = await interaction.guild.channels.fetch(threadId);
        return await thread.fetchStarterMessage();
    } catch (error) {
        logger.error(`Failed to fetch starter message for thread ${threadId}:`, error.message);
        return null;
    }
};

// The one place a report changes state: claim it in the database, tell the
// reporter, stamp the thread. The claim goes first and everything after it is
// conditional on winning, because the DM and the thread stamp are the parts that
// cannot be taken back. A report that reads "denied" in the forum while the
// database still says open would sit in the queue forever.
const applyOutcome = async (interaction, outcomeKey, context) => {
    const outcome = OUTCOMES[outcomeKey];
    let { refId, reporterId, reportedName, message } = context;

    if (refId) {
        let claimed;
        try {
            claimed = await setReportStatus(refId, outcome.status, interaction.user.id);
        } catch (dbError) {
            logger.error(`Failed to record outcome for ${refId}:`, dbError);
            return { ok: false, error: 'write-failed', outcome };
        }

        if (claimed) {
            reporterId = reporterId || claimed.reporter_id;
            reportedName = reportedName || claimed.reported_name;
            message = message || await resolveThreadMessage(interaction, claimed.thread_id);
        } else {
            // No claim: either someone already resolved it, or the report predates
            // indexing and has no row. Only the first is a conflict.
            const existing = await fetchReportByRefId(refId).catch(() => null);
            if (existing) {
                return { ok: false, error: 'already-resolved', existing, outcome };
            }
        }
    }

    await sendOutcomeDm(interaction, outcome, { reporterId, refId, reportedName });
    await stampThreadMessage(message, outcome, interaction.user.id, refId);

    return { ok: true, outcome };
};

// Copy for the two ways an action can be refused, so both surfaces say the same thing.
const refusalNotice = (result) => {
    if (result.error === 'already-resolved') {
        const by = result.existing.actioned_by ? ` by <@${result.existing.actioned_by}>` : '';
        return {
            title: 'Already Actioned',
            lines: [
                `This report was already marked **${STATUS_LABEL[result.existing.status] || result.existing.status}**${by}.`,
                'Nothing was sent to the reporter.',
            ],
        };
    }
    return {
        title: 'Action Failed',
        lines: [
            'The outcome could not be recorded, so nothing was sent to the reporter and the thread was left alone.',
            'Please try again.',
        ],
    };
};

// --- forum thread buttons -------------------------------------------------

const handleForumAction = async (interaction, outcomeKey) => {
    try {
        await interaction.deferReply({ ephemeral: true });

        if (!canActionReports(interaction)) {
            await interaction.editReply(noticePayload(
                'You do not have permission to action reports.',
                { title: 'Permission Denied', subtitle: 'Player Reports' }
            ));
            return;
        }

        const result = await applyOutcome(interaction, outcomeKey, {
            refId: extractRefId(interaction.channel),
            reporterId: interaction.customId.split('_')[1],
            reportedName: extractReportedUser(interaction.channel),
            message: interaction.message,
        });

        if (!result.ok) {
            const refusal = refusalNotice(result);
            await interaction.editReply(noticePayload(refusal.lines, {
                title: refusal.title,
                subtitle: 'Player Reports',
            }));
            return;
        }

        await interaction.editReply(noticePayload(
            result.outcome.confirmation,
            { title: result.outcome.threadTitle, subtitle: 'Player Report' }
        ));
    } catch (error) {
        logger.error(`Error actioning report (${outcomeKey}):`, error);
        if (interaction.deferred && !interaction.replied) {
            await interaction.editReply(noticePayload(
                'There was an error while actioning the report. Please try again later.',
                { title: 'Action Failed', subtitle: 'Player Reports' }
            )).catch(() => {});
        }
    }
};

const handleReportApprove = (interaction) => handleForumAction(interaction, 'approved');
const handleReportDeny = (interaction) => handleForumAction(interaction, 'denied');
const handleReportInfo = (interaction) => handleForumAction(interaction, 'needs_info');

// --- /reports queue buttons -----------------------------------------------

const renderQueue = async (filter, index) => {
    const rows = sortByPriority(await fetchQueueReports([filter]));
    return buildQueueCard(rows, index, filter);
};

const QUEUE_VERB_OUTCOME = { approve: 'approved', deny: 'denied', info: 'needs_info' };

// customId: rpt:<verb>:<filter>:<refId>:<index>
const handleReportQueueButton = async (interaction) => {
    try {
        const [, verb, filter, refId, rawIndex] = interaction.customId.split(':');
        const index = parseInt(rawIndex, 10) || 0;

        if (!canActionReports(interaction)) {
            await interaction.reply({
                ...noticePayload(
                    'You do not have permission to action reports.',
                    { title: 'Permission Denied', subtitle: 'Player Reports' }
                ),
                ephemeral: true,
            });
            return;
        }

        await interaction.deferUpdate();

        if (verb === 'next' || verb === 'prev') {
            const target = verb === 'next' ? index + 1 : index - 1;
            await interaction.editReply(await renderQueue(filter, target));
            return;
        }

        const outcomeKey = QUEUE_VERB_OUTCOME[verb];
        if (!outcomeKey) {
            logger.warn(`Unknown report queue verb: ${verb}`);
            return;
        }

        const report = await fetchReportByRefId(refId);
        const result = await applyOutcome(interaction, outcomeKey, {
            refId,
            reporterId: report?.reporter_id,
            reportedName: report?.reported_name,
        });

        // Approve and deny both move the report out of whichever queue it was in,
        // so the same index now holds the next one to look at. Need Info is not
        // offered from the needs_info queue precisely because it would not.
        await interaction.editReply(await renderQueue(filter, index));

        if (!result.ok) {
            const refusal = refusalNotice(result);
            await interaction.followUp({
                ...noticePayload(refusal.lines, { title: refusal.title, subtitle: refId }),
                ephemeral: true,
            });
        }
    } catch (error) {
        logger.error('Error handling report queue button:', error);
        if (interaction.deferred) {
            await interaction.editReply(noticePayload(
                'There was an error while updating the queue. Run /reports queue again.',
                { title: 'Queue Error', subtitle: 'Player Reports' }
            )).catch(() => {});
        }
    }
};

module.exports = {
    canActionReports,
    renderQueue,
    handleReportApprove,
    handleReportDeny,
    handleReportInfo,
    handleReportQueueButton,
};
