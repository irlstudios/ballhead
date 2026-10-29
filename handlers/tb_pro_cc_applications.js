'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ContainerBuilder } = require('discord.js');
const logger = require('../utils/logger');
const { buildTextBlock, noticePayload } = require('../utils/ui');
const {
    fetchApplicant,
    isHttpUrl,
    refuseUnlessReviewer,
    claimOrReport,
    releaseApplicationDecision,
} = require('../utils/applications');
const {
    ensureTbProCcApplicationsTable,
    findTbProCcApplication,
    insertTbProCcApplication,
    deleteTbProCcApplication,
} = require('../db');
const {
    TB_PRO_CC_APPLICATIONS_CHANNEL_ID,
    TB_PRO_CC_ROLE_ID,
    TB_PRO_CC_ELIGIBLE_ROLE_IDS,
} = require('../config/constants');

const SUBTITLE = 'TB PRO CC Application';
const PROGRAM = 'TB PRO CC Program';

const replyNotice = (interaction, message, title) => interaction.reply({
    ...noticePayload(message, { title, subtitle: SUBTITLE }),
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
});

const handleTbProCcApplicationSubmission = async (interaction) => {
    try {
        const discordId = interaction.user.id;

        await ensureTbProCcApplicationsTable();

        const existingRows = await findTbProCcApplication(discordId);
        if (existingRows.length > 0) {
            await replyNotice(interaction, 'You have already submitted an application. Please wait for it to be reviewed.', 'Application Already Submitted');
            return;
        }

        let member;
        try {
            member = await interaction.guild.members.fetch(discordId);
        } catch (error) {
            logger.error('Error fetching guild member:', error);
            await replyNotice(interaction, 'Failed to fetch your member data.', 'Member Lookup Failed');
            return;
        }

        if (member.roles.cache.has(TB_PRO_CC_ROLE_ID)) {
            await replyNotice(interaction, 'You are already TB PRO CC and cannot submit another application.', 'Already TB PRO CC');
            return;
        }

        // Re-checked here because a role can be removed while the form is open.
        if (!TB_PRO_CC_ELIGIBLE_ROLE_IDS.some(roleId => member.roles.cache.has(roleId))) {
            await replyNotice(interaction, 'Only Sponsored CC and Top Active CC members can apply for TB PRO CC.', 'Role Required');
            return;
        }

        let mainLink, bestClip, motivation, community;
        try {
            mainLink = interaction.fields.getTextInputValue('tbpccMainLink').trim();
            bestClip = interaction.fields.getTextInputValue('tbpccBestClip').trim();
            motivation = interaction.fields.getTextInputValue('tbpccMotivation');
            community = interaction.fields.getTextInputValue('tbpccCommunity');
        } catch (error) {
            logger.error('Error parsing TB PRO CC application fields:', error);
            await replyNotice(interaction, 'There was an issue processing your form submission.', 'Form Error');
            return;
        }

        if (!isHttpUrl(mainLink) || !isHttpUrl(bestClip)) {
            await replyNotice(
                interaction,
                'Both links must be full URLs (starting with http:// or https://). Please run /apply tb-pro-cc again with valid links.',
                'Invalid Link'
            );
            return;
        }

        const applicationsChannel = interaction.guild.channels.cache.get(TB_PRO_CC_APPLICATIONS_CHANNEL_ID);
        if (!applicationsChannel) {
            logger.error(`Channel with ID '${TB_PRO_CC_APPLICATIONS_CHANNEL_ID}' not found.`);
            await replyNotice(interaction, 'There was an issue submitting your application.', 'Submission Failed');
            return;
        }

        const currentCcRoles = TB_PRO_CC_ELIGIBLE_ROLE_IDS.filter(roleId => member.roles.cache.has(roleId));

        const applicationContainer = new ContainerBuilder();
        const block = buildTextBlock({
            title: 'New TB PRO CC Application',
            subtitle: member.user.tag,
            lines: [
                `**Applicant:** <@${discordId}>`,
                `**Current CC role:** ${currentCcRoles.map(id => `<@&${id}>`).join(', ')}`,
                `**Main channel:** ${mainLink}`,
                `**Best Gym Class video:** ${bestClip}`,
                `**Why TB PRO CC:** ${motivation || 'Not provided'}`,
                `**How they help the community:** ${community || 'Not provided'}`,
            ],
        });
        if (block) applicationContainer.addTextDisplayComponents(block);

        const actionRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`tbpccApprove_${discordId}`).setLabel('Accept').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`tbpccReject_${discordId}`).setLabel('Deny').setStyle(ButtonStyle.Danger),
        );

        const applicationMessage = await applicationsChannel.send({
            flags: MessageFlags.IsComponentsV2,
            components: [applicationContainer, actionRow],
        });

        await insertTbProCcApplication({
            discordId,
            username: member.user.tag,
            mainLink,
            bestClip,
            motivation,
            community,
            applicationUrl: applicationMessage.url,
        });

        await replyNotice(interaction, 'Thank you for submitting your TB PRO CC application!', 'Application Submitted');
    } catch (error) {
        logger.error('Unexpected error in handleTbProCcApplicationSubmission:', error);
    }
};

const sendDecisionDm = async (user, title, subtitle, line) => {
    try {
        const dmContainer = new ContainerBuilder();
        const block = buildTextBlock({ title, subtitle, lines: [line] });
        if (block) dmContainer.addTextDisplayComponents(block);
        await user.send({ flags: MessageFlags.IsComponentsV2, components: [dmContainer] });
    } catch (dmError) {
        logger.error('Failed to send DM to user:', dmError.message);
    }
};

const closeApplicationCard = async (interaction, title, verb) => {
    const container = new ContainerBuilder();
    const block = buildTextBlock({
        title,
        subtitle: PROGRAM,
        lines: [`This application has been ${verb} by <@${interaction.user.id}>.`],
    });
    if (block) container.addTextDisplayComponents(block);
    await interaction.message.edit({ flags: MessageFlags.IsComponentsV2, components: [container] });
};

const handleTbProCcApplicationApprove = async (interaction) => {
    let claimId = null;
    try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (await refuseUnlessReviewer(interaction, {}, PROGRAM)) return;

        const userId = interaction.customId.split('_')[1];
        const user = await fetchApplicant(interaction.guild, userId);
        if (!user) {
            await interaction.editReply({
                ...noticePayload(
                    'This applicant has left the server, so the application cannot be accepted. Use Deny to close it.',
                    { title: 'Applicant Left', subtitle: PROGRAM }
                ),
            });
            return;
        }

        claimId = await claimOrReport(interaction, { program: 'tb_pro_cc', applicantId: userId, decision: 'Accepted' }, PROGRAM);
        if (!claimId) return;

        await sendDecisionDm(
            user,
            'TB PRO CC Application Accepted',
            'TB PRO CC role granted',
            'Congratulations! Your TB PRO CC application has been accepted.'
        );

        const role = interaction.guild.roles.cache.get(TB_PRO_CC_ROLE_ID);
        if (role) {
            await user.roles.add(role);
        } else {
            logger.error(`TB PRO CC role '${TB_PRO_CC_ROLE_ID}' not found in guild.`);
        }

        await deleteTbProCcApplication(userId);
        await closeApplicationCard(interaction, 'Application Accepted', 'accepted');
        claimId = null; // decided: keep the record even if the reply below fails

        await interaction.editReply({
            ...noticePayload('The application has been successfully accepted!', { title: 'Application Accepted', subtitle: PROGRAM }),
        });
    } catch (error) {
        logger.error('Error approving TB PRO CC application:', error);
        await releaseApplicationDecision(claimId);
        await interaction.editReply({
            ...noticePayload(
                'There was an error while accepting the application. Please try again later.',
                { title: 'Approval Failed', subtitle: PROGRAM }
            ),
        }).catch((replyError) => logger.error('Failed to send approval error reply:', replyError));
    }
};

const handleTbProCcApplicationReject = async (interaction) => {
    let claimId = null;
    try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (await refuseUnlessReviewer(interaction, {}, PROGRAM)) return;

        const userId = interaction.customId.split('_')[1];
        const user = await fetchApplicant(interaction.guild, userId);

        claimId = await claimOrReport(interaction, { program: 'tb_pro_cc', applicantId: userId, decision: 'Denied' }, PROGRAM);
        if (!claimId) return;

        if (user) {
            await sendDecisionDm(
                user,
                'TB PRO CC Application Denied',
                'Application reviewed',
                'Unfortunately, your TB PRO CC application has been denied. You are welcome to apply again in the future.'
            );
        }

        await deleteTbProCcApplication(userId);
        await closeApplicationCard(interaction, 'Application Denied', 'denied');
        claimId = null; // decided: keep the record even if the reply below fails

        await interaction.editReply({
            ...noticePayload(
                user
                    ? 'The application has been successfully denied!'
                    : 'The application has been denied. The applicant had already left the server, so no DM was sent.',
                { title: 'Application Denied', subtitle: PROGRAM }
            ),
        });
    } catch (error) {
        logger.error('Error denying TB PRO CC application:', error);
        await releaseApplicationDecision(claimId);
        await interaction.editReply({
            ...noticePayload(
                'There was an error while denying the application. Please try again later.',
                { title: 'Denial Failed', subtitle: PROGRAM }
            ),
        }).catch((replyError) => logger.error('Failed to send denial error reply:', replyError));
    }
};

module.exports = {
    handleTbProCcApplicationSubmission,
    handleTbProCcApplicationApprove,
    handleTbProCcApplicationReject,
};
