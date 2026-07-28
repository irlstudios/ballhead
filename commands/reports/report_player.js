'use strict';

const { SlashCommandBuilder } = require('@discordjs/builders');
const {
    MessageFlags, ContainerBuilder, MediaGalleryBuilder,
    MediaGalleryItemBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const crypto = require('crypto');
const logger = require('../../utils/logger');
const { buildTextBlock, noticePayload } = require('../../utils/ui');
const { REPORTS_FORUM_CHANNEL_ID } = require('../../config/constants');
const { SEVERITIES, PROOF_ERRORS, severityLabel, validateReportProof } = require('../../utils/reports_logic');
const { insertPlayerReport } = require('../../utils/reports_queries');

function generateReportId() {
    return `RPT-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('report-player')
        .setDescription('Report a player who has broken the rules.')
        .addStringOption(option =>
            option.setName('username')
                .setDescription('Username of the player to report')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('rule-broken')
                .setDescription('Describe the rule broken by the player')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('severity')
                .setDescription('What kind of behaviour was it?')
                .setRequired(true)
                .addChoices(...SEVERITIES.map(s => ({ name: s.label, value: s.value }))))
        .addStringOption(option =>
            option.setName('proof-description')
                .setDescription('What does your proof show, and when does it happen?')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('time-of-offense')
                .setDescription('Time of offense (e.g., 2025-03-10 14:30 UTC)')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('lobby-name')
                .setDescription('Lobby name where the offense occurred')
                .setRequired(true))
        .addAttachmentOption(option =>
            option.setName('proof')
                .setDescription('Screenshot or video of the offense (required unless you paste a link)')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('proof-link')
                .setDescription('Link to a clip (Medal, YouTube, Streamable) if your file is too big to upload')
                .setRequired(false)),

    async execute(interaction) {
        try {
            await interaction.deferReply({ ephemeral: true });

            const reportedUser = interaction.options.getString('username');
            const ruleBroken = interaction.options.getString('rule-broken');
            const severity = interaction.options.getString('severity');
            const timeOfOffense = interaction.options.getString('time-of-offense');
            const lobbyName = interaction.options.getString('lobby-name');
            const proof = interaction.options.getAttachment('proof');

            // The real proof gate. Rejected reports never reach the forum, so
            // moderators no longer spend a review on an empty report.
            const validation = validateReportProof({
                attachment: proof,
                link: interaction.options.getString('proof-link'),
                description: interaction.options.getString('proof-description'),
            });
            if (!validation.ok) {
                await interaction.editReply(noticePayload(
                    [PROOF_ERRORS[validation.reason], '', 'Nothing was submitted. Run the command again with proof attached.'],
                    { title: 'Proof Required', subtitle: 'Player Report' }
                ));
                return;
            }

            const refId = generateReportId();

            const reportContainer = new ContainerBuilder();
            const block = buildTextBlock({
                title: `Player Report: ${reportedUser}`,
                subtitle: 'Submitted to Gym Class VR moderation',
                lines: [
                    `**Reference ID:** ${refId}`,
                    `**Report From:** ${interaction.user.tag}`,
                    `**User Reported:** ${reportedUser}`,
                    `**Severity:** ${severityLabel(severity)}`,
                    `**Rule Broken:** ${ruleBroken}`,
                    `**Time of Offense:** ${timeOfOffense}`,
                    `**Lobby Name:** ${lobbyName}`,
                    `**Proof Shows:** ${validation.description}`,
                    validation.link ? `**Proof Link:** ${validation.link}` : null,
                ],
            });
            if (block) reportContainer.addTextDisplayComponents(block);

            // Posting the attachment into the thread is what makes it durable:
            // the signed URL on the interaction expires, the copy Discord hosts
            // in this message does not.
            if (proof) {
                reportContainer.addMediaGalleryComponents(
                    new MediaGalleryBuilder().addItems(
                        new MediaGalleryItemBuilder().setURL(proof.url)
                    )
                );
            }

            const reporterId = interaction.user.id;
            const actionRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`reportApprove_${reporterId}`)
                    .setLabel('Approved')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`reportDeny_${reporterId}`)
                    .setLabel('Denied')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId(`reportInfo_${reporterId}`)
                    .setLabel('Needs More Information')
                    .setStyle(ButtonStyle.Secondary)
            );

            const forumChannel = interaction.guild.channels.cache.get(REPORTS_FORUM_CHANNEL_ID);
            if (!forumChannel) {
                throw new Error('The forum channel for reports could not be found.');
            }

            const thread = await forumChannel.threads.create({
                name: `${refId} | Report: ${reportedUser}`,
                message: {
                    flags: MessageFlags.IsComponentsV2,
                    components: [reportContainer, actionRow],
                },
            });

            // The thread is the report. If indexing it fails the reporter should
            // still be told it went through, and the backfill picks the thread up
            // later rather than the reporter filing a duplicate.
            try {
                await insertPlayerReport({
                    refId,
                    reporterId,
                    reporterTag: interaction.user.tag,
                    reportedName: reportedUser,
                    severity,
                    ruleBroken,
                    proofDescription: validation.description,
                    proofUrl: validation.link,
                    timeOfOffense,
                    lobbyName,
                    threadId: thread.id,
                    threadUrl: thread.url,
                });
            } catch (dbError) {
                logger.error(`Failed to index report ${refId}:`, dbError);
            }

            await interaction.editReply(noticePayload([
                'Your report has been submitted successfully.',
                `**Your Reference ID:** ${refId}`,
                'Save this ID if you need to follow up with a moderator.',
            ], { title: 'Report Submitted', subtitle: reportedUser }));
        } catch (error) {
            logger.error('Error handling report submission:', error);
            await interaction.editReply(noticePayload(
                'There was an error while submitting your report. Please try again later.',
                { title: 'Report Failed', subtitle: 'Try Again Later' }
            ));
        }
    },
};
