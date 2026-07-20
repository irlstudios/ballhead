'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ContainerBuilder } = require('discord.js');
const logger = require('../utils/logger');
const { buildTextBlock, noticePayload } = require('../utils/ui');
const {
    ensureBugSquasherApplicationsTable,
    findBugSquasherApplication,
    insertBugSquasherApplication,
    deleteBugSquasherApplication,
} = require('../db');
const {
    CBS_APPLICATIONS_CHANNEL_ID,
    COMMUNITY_BUG_SQUASHER_ROLE_ID,
} = require('../config/constants');

const SUBTITLE = 'Community Bug Squasher Application';
const isYes = (value) => value.trim().toLowerCase().startsWith('y');

const handleBugSquasherApplicationSubmission = async (interaction) => {
    try {
        const discordId = interaction.user.id;

        await ensureBugSquasherApplicationsTable();

        const existingRows = await findBugSquasherApplication(discordId);
        if (existingRows.length > 0) {
            await interaction.reply({
                ...noticePayload(
                    'You have already submitted an application. Please wait for it to be reviewed.',
                    { title: 'Application Already Submitted', subtitle: SUBTITLE }
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
                    { title: 'Member Lookup Failed', subtitle: SUBTITLE }
                ),
                ephemeral: true,
            });
            return;
        }

        if (member.roles.cache.has(COMMUNITY_BUG_SQUASHER_ROLE_ID)) {
            await interaction.reply({
                ...noticePayload(
                    'You are already a Community Bug Squasher and cannot submit another application.',
                    { title: 'Already a Bug Squasher', subtitle: SUBTITLE }
                ),
                ephemeral: true,
            });
            return;
        }

        let requirementsAware, noGuaranteeAware, tosAware, motivation, valueAdd;
        try {
            requirementsAware = isYes(interaction.fields.getTextInputValue('cbsRequirementsAware'));
            noGuaranteeAware = isYes(interaction.fields.getTextInputValue('cbsNoGuarantee'));
            tosAware = isYes(interaction.fields.getTextInputValue('cbsTosAware'));
            motivation = interaction.fields.getTextInputValue('cbsMotivation');
            valueAdd = interaction.fields.getTextInputValue('cbsValue');
        } catch (error) {
            logger.error('Error parsing bug squasher application fields:', error);
            await interaction.reply({
                ...noticePayload(
                    'There was an issue processing your form submission.',
                    { title: 'Form Error', subtitle: SUBTITLE }
                ),
                ephemeral: true,
            });
            return;
        }

        const applicationsChannel = interaction.guild.channels.cache.get(CBS_APPLICATIONS_CHANNEL_ID);
        if (!applicationsChannel) {
            logger.error(`Channel with ID '${CBS_APPLICATIONS_CHANNEL_ID}' not found.`);
            await interaction.reply({
                ...noticePayload(
                    'There was an issue submitting your application.',
                    { title: 'Submission Failed', subtitle: SUBTITLE }
                ),
                ephemeral: true,
            });
            return;
        }

        const applicationContainer = new ContainerBuilder();
        const block = buildTextBlock({
            title: 'New Community Bug Squasher Application',
            subtitle: member.user.tag,
            lines: [
                `**Applicant:** <@${discordId}>`,
                `**Aware of CBS requirements:** ${requirementsAware ? 'Yes' : 'No'}`,
                `**Aware applying is not a guarantee:** ${noGuaranteeAware ? 'Yes' : 'No'}`,
                `**Aware TOS breaks / begging can bar the role:** ${tosAware ? 'Yes' : 'No'}`,
                `**Why Community Bug Squasher:** ${motivation || 'Not provided'}`,
                `**What they bring vs. others:** ${valueAdd || 'Not provided'}`,
            ],
        });
        if (block) applicationContainer.addTextDisplayComponents(block);

        const approveButton = new ButtonBuilder()
            .setCustomId(`cbsApprove_${discordId}`)
            .setLabel('Accept')
            .setStyle(ButtonStyle.Success);

        const rejectButton = new ButtonBuilder()
            .setCustomId(`cbsReject_${discordId}`)
            .setLabel('Deny')
            .setStyle(ButtonStyle.Danger);

        const actionRow = new ActionRowBuilder().addComponents(approveButton, rejectButton);

        const applicationMessage = await applicationsChannel.send({
            flags: MessageFlags.IsComponentsV2,
            components: [applicationContainer, actionRow],
        });

        await insertBugSquasherApplication({
            discordId,
            username: member.user.tag,
            requirementsAware,
            noGuaranteeAware,
            tosAware,
            motivation,
            valueAdd,
            applicationUrl: applicationMessage.url,
        });

        await interaction.reply({
            ...noticePayload(
                'Thank you for submitting your Community Bug Squasher application!',
                { title: 'Application Submitted', subtitle: SUBTITLE }
            ),
            ephemeral: true,
        });
    } catch (error) {
        logger.error('Unexpected error in handleBugSquasherApplicationSubmission:', error);
    }
};

const handleBugSquasherApplicationApprove = async (interaction) => {
    try {
        await interaction.deferReply({ ephemeral: true });

        const userId = interaction.customId.split('_')[1];
        const user = await interaction.guild.members.fetch(userId);

        try {
            const dmContainer = new ContainerBuilder();
            const block = buildTextBlock({
                title: 'Community Bug Squasher Application Accepted',
                subtitle: 'Community Bug Squasher role granted',
                lines: ['Congratulations! Your Community Bug Squasher application has been accepted.'],
            });
            if (block) dmContainer.addTextDisplayComponents(block);
            await user.send({ flags: MessageFlags.IsComponentsV2, components: [dmContainer] });
        } catch (dmError) {
            logger.error('Failed to send DM to user:', dmError.message);
        }

        const bugSquasherRole = interaction.guild.roles.cache.get(COMMUNITY_BUG_SQUASHER_ROLE_ID);
        if (bugSquasherRole) {
            await user.roles.add(bugSquasherRole);
        } else {
            logger.error(`Community Bug Squasher role '${COMMUNITY_BUG_SQUASHER_ROLE_ID}' not found in guild.`);
        }

        await deleteBugSquasherApplication(userId);

        const approvedContainer = new ContainerBuilder();
        const block = buildTextBlock({
            title: 'Application Accepted',
            subtitle: 'Community Bug Squasher Program',
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
                { title: 'Application Accepted', subtitle: 'Community Bug Squasher Program' }
            ),
            ephemeral: true,
        });
    } catch (error) {
        logger.error('Error approving bug squasher application:', error);

        if (!interaction.replied) {
            await interaction.editReply({
                ...noticePayload(
                    'There was an error while accepting the application. Please try again later.',
                    { title: 'Approval Failed', subtitle: 'Community Bug Squasher Program' }
                ),
                ephemeral: true,
            });
        }
    }
};

const handleBugSquasherApplicationReject = async (interaction) => {
    try {
        await interaction.deferReply({ ephemeral: true });

        const userId = interaction.customId.split('_')[1];
        const user = await interaction.guild.members.fetch(userId);

        try {
            const dmContainer = new ContainerBuilder();
            const block = buildTextBlock({
                title: 'Community Bug Squasher Application Denied',
                subtitle: 'Application reviewed',
                lines: ['Unfortunately, your Community Bug Squasher application has been denied. You are welcome to apply again in the future.'],
            });
            if (block) dmContainer.addTextDisplayComponents(block);
            await user.send({ flags: MessageFlags.IsComponentsV2, components: [dmContainer] });
        } catch (dmError) {
            logger.error('Failed to send DM to user:', dmError.message);
        }

        await deleteBugSquasherApplication(userId);

        const rejectedContainer = new ContainerBuilder();
        const block = buildTextBlock({
            title: 'Application Denied',
            subtitle: 'Community Bug Squasher Program',
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
                { title: 'Application Denied', subtitle: 'Community Bug Squasher Program' }
            ),
            ephemeral: true,
        });
    } catch (error) {
        logger.error('Error denying bug squasher application:', error);

        if (!interaction.replied) {
            await interaction.editReply({
                ...noticePayload(
                    'There was an error while denying the application. Please try again later.',
                    { title: 'Denial Failed', subtitle: 'Community Bug Squasher Program' }
                ),
                ephemeral: true,
            });
        }
    }
};

module.exports = {
    handleBugSquasherApplicationSubmission,
    handleBugSquasherApplicationApprove,
    handleBugSquasherApplicationReject,
};
