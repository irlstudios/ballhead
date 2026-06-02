'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ContainerBuilder } = require('discord.js');
const logger = require('../utils/logger');
const { buildTextBlock, noticePayload } = require('../utils/ui');
const {
    ensureFfOfficialApplicationsTable,
    findFfOfficialApplication,
    insertFfOfficialApplication,
    deleteFfOfficialApplication,
} = require('../db');
const {
    FF_OFFICIAL_APPLICATIONS_CHANNEL_ID,
    FF_OFFICIAL_ELIGIBLE_ROLE_IDS,
    FF_OFFICIAL_ROLE_ID,
    OFFICIAL_SENIOR_ROLE_ID,
    FF_APPLICATION_MANAGERS,
} = require('../config/constants');

const resolveCurrentRole = (member) => {
    if (member.roles.cache.has(OFFICIAL_SENIOR_ROLE_ID)) {
        return 'Senior Official';
    }
    return 'Active Official';
};

const handleFfOfficialApplicationSubmission = async (interaction) => {
    try {
        const discordId = interaction.user.id;

        await ensureFfOfficialApplicationsTable();

        const existingRows = await findFfOfficialApplication(discordId);
        if (existingRows.length > 0) {
            await interaction.reply({
                ...noticePayload(
                    'You have already submitted an application. Please wait for it to be reviewed.',
                    { title: 'Application Already Submitted', subtitle: 'FF Official Application' }
                ),
                ephemeral: true,
            });
            return;
        }

        let member;
        try {
            member = await interaction.guild.members.fetch(discordId);
        } catch (error) {
            logger.error('Error fetching guild member:', error);
            await interaction.reply({
                ...noticePayload(
                    'Failed to fetch your member data.',
                    { title: 'Member Lookup Failed', subtitle: 'FF Official Application' }
                ),
                ephemeral: true,
            });
            return;
        }

        if (member.roles.cache.has(FF_OFFICIAL_ROLE_ID)) {
            await interaction.reply({
                ...noticePayload(
                    'You are already an FF Official and cannot submit another application.',
                    { title: 'Already an FF Official', subtitle: 'FF Official Application' }
                ),
                ephemeral: true,
            });
            return;
        }

        if (!FF_OFFICIAL_ELIGIBLE_ROLE_IDS.some(roleId => member.roles.cache.has(roleId))) {
            await interaction.reply({
                ...noticePayload(
                    'Only Active Officials and Senior Officials can apply to become an FF Official.',
                    { title: 'Role Required', subtitle: 'FF Official Application' }
                ),
                ephemeral: true,
            });
            return;
        }

        let inGameUsername, officiatingDuration, understandsRules, motivation, statsLink;
        try {
            inGameUsername = interaction.fields.getTextInputValue('ffUsername');
            officiatingDuration = interaction.fields.getTextInputValue('ffOfficiatingDuration');
            understandsRules = interaction.fields.getTextInputValue('ffRulesUnderstanding').toLowerCase() === 'yes';
            motivation = interaction.fields.getTextInputValue('ffMotivation');
            statsLink = interaction.fields.getTextInputValue('ffStatsLink');
        } catch (error) {
            logger.error('Error parsing FF official application fields:', error);
            await interaction.reply({
                ...noticePayload(
                    'There was an issue processing your form submission.',
                    { title: 'Form Error', subtitle: 'FF Official Application' }
                ),
                ephemeral: true,
            });
            return;
        }

        const currentRole = resolveCurrentRole(member);

        const applicationsChannel = interaction.guild.channels.cache.get(FF_OFFICIAL_APPLICATIONS_CHANNEL_ID);
        if (!applicationsChannel) {
            logger.error(`Channel with ID '${FF_OFFICIAL_APPLICATIONS_CHANNEL_ID}' not found.`);
            await interaction.reply({
                ...noticePayload(
                    'There was an issue submitting your application.',
                    { title: 'Submission Failed', subtitle: 'FF Official Application' }
                ),
                ephemeral: true,
            });
            return;
        }

        const applicationContainer = new ContainerBuilder();
        const block = buildTextBlock({
            title: 'New FF Official Application',
            subtitle: member.user.tag,
            lines: [
                `**Applicant:** <@${discordId}>`,
                `**In-Game Username:** ${inGameUsername || 'Not provided'}`,
                `**Current Role:** ${currentRole}`,
                `**Time Officiating:** ${officiatingDuration || 'Not provided'}`,
                `**Read/Understands FF Rules:** ${understandsRules ? 'Yes' : 'No'}`,
                `**Why FF Official:** ${motivation || 'Not provided'}`,
                `**Recent FF Stats/Submissions:** ${statsLink || 'Not provided'}`,
            ],
        });
        if (block) applicationContainer.addTextDisplayComponents(block);

        const approveButton = new ButtonBuilder()
            .setCustomId(`ffApprove_${discordId}`)
            .setLabel('Accept')
            .setStyle(ButtonStyle.Success);

        const rejectButton = new ButtonBuilder()
            .setCustomId(`ffReject_${discordId}`)
            .setLabel('Deny')
            .setStyle(ButtonStyle.Danger);

        const actionRow = new ActionRowBuilder().addComponents(approveButton, rejectButton);

        const applicationMessage = await applicationsChannel.send({
            flags: MessageFlags.IsComponentsV2,
            components: [applicationContainer, actionRow],
        });

        await insertFfOfficialApplication({
            discordId,
            username: member.user.tag,
            inGameUsername,
            currentRole,
            officiatingDuration,
            understandsRules,
            motivation,
            statsLink,
            applicationUrl: applicationMessage.url,
        });

        await interaction.reply({
            ...noticePayload(
                'Thank you for submitting your FF Official application!',
                { title: 'Application Submitted', subtitle: 'FF Official Application' }
            ),
            ephemeral: true,
        });
    } catch (error) {
        logger.error('Unexpected error in handleFfOfficialApplicationSubmission:', error);
    }
};

const handleFfOfficialApplicationApprove = async (interaction) => {
    try {
        await interaction.deferReply({ ephemeral: true });

        if (!FF_APPLICATION_MANAGERS.includes(interaction.user.id)) {
            await interaction.editReply({
                ...noticePayload('You do not have permission to approve applications.', { title: 'Permission Denied', subtitle: 'FF Official Program' }),
                ephemeral: true,
            });
            return;
        }

        const userId = interaction.customId.split('_')[1];
        const user = await interaction.guild.members.fetch(userId);

        try {
            const dmContainer = new ContainerBuilder();
            const block = buildTextBlock({
                title: 'FF Official Application Accepted',
                subtitle: 'FF Official role granted',
                lines: ['Congratulations! Your FF Official application has been accepted.'],
            });
            if (block) dmContainer.addTextDisplayComponents(block);
            await user.send({ flags: MessageFlags.IsComponentsV2, components: [dmContainer] });
        } catch (dmError) {
            logger.error('Failed to send DM to user:', dmError.message);
        }

        const ffOfficialRole = interaction.guild.roles.cache.get(FF_OFFICIAL_ROLE_ID);
        if (ffOfficialRole) {
            await user.roles.add(ffOfficialRole);
        } else {
            logger.error(`FF Official role '${FF_OFFICIAL_ROLE_ID}' not found in guild.`);
        }

        await deleteFfOfficialApplication(userId);

        const approvedContainer = new ContainerBuilder();
        const block = buildTextBlock({
            title: 'Application Accepted',
            subtitle: 'FF Official Program',
            lines: [`This application has been accepted by <@${interaction.user.id}>.`],
        });
        if (block) approvedContainer.addTextDisplayComponents(block);

        await interaction.message.edit({
            flags: MessageFlags.IsComponentsV2,
            components: [approvedContainer],
        });

        await interaction.editReply({
            ...noticePayload(
                'The application has been successfully accepted!',
                { title: 'Application Accepted', subtitle: 'FF Official Program' }
            ),
            ephemeral: true,
        });
    } catch (error) {
        logger.error('Error approving FF official application:', error);

        if (!interaction.replied) {
            await interaction.editReply({
                ...noticePayload(
                    'There was an error while accepting the application. Please try again later.',
                    { title: 'Approval Failed', subtitle: 'FF Official Program' }
                ),
                ephemeral: true,
            });
        }
    }
};

const handleFfOfficialApplicationReject = async (interaction) => {
    try {
        await interaction.deferReply({ ephemeral: true });

        if (!FF_APPLICATION_MANAGERS.includes(interaction.user.id)) {
            await interaction.editReply({
                ...noticePayload('You do not have permission to deny applications.', { title: 'Permission Denied', subtitle: 'FF Official Program' }),
                ephemeral: true,
            });
            return;
        }

        const userId = interaction.customId.split('_')[1];
        const user = await interaction.guild.members.fetch(userId);

        try {
            const dmContainer = new ContainerBuilder();
            const block = buildTextBlock({
                title: 'FF Official Application Denied',
                subtitle: 'Application reviewed',
                lines: ['Unfortunately, your FF Official application has been denied. You are welcome to apply again in the future.'],
            });
            if (block) dmContainer.addTextDisplayComponents(block);
            await user.send({ flags: MessageFlags.IsComponentsV2, components: [dmContainer] });
        } catch (dmError) {
            logger.error('Failed to send DM to user:', dmError.message);
        }

        await deleteFfOfficialApplication(userId);

        const rejectedContainer = new ContainerBuilder();
        const block = buildTextBlock({
            title: 'Application Denied',
            subtitle: 'FF Official Program',
            lines: [`This application has been denied by <@${interaction.user.id}>.`],
        });
        if (block) rejectedContainer.addTextDisplayComponents(block);

        await interaction.message.edit({
            flags: MessageFlags.IsComponentsV2,
            components: [rejectedContainer],
        });

        await interaction.editReply({
            ...noticePayload(
                'The application has been successfully denied!',
                { title: 'Application Denied', subtitle: 'FF Official Program' }
            ),
            ephemeral: true,
        });
    } catch (error) {
        logger.error('Error denying FF official application:', error);

        if (!interaction.replied) {
            await interaction.editReply({
                ...noticePayload(
                    'There was an error while denying the application. Please try again later.',
                    { title: 'Denial Failed', subtitle: 'FF Official Program' }
                ),
                ephemeral: true,
            });
        }
    }
};

module.exports = {
    handleFfOfficialApplicationSubmission,
    handleFfOfficialApplicationApprove,
    handleFfOfficialApplicationReject,
};
