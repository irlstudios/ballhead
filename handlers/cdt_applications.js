'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ContainerBuilder } = require('discord.js');
const logger = require('../utils/logger');
const { buildTextBlock, noticePayload } = require('../utils/ui');
const {
    ensureCdtApplicationsTable,
    findCdtApplication,
    insertCdtApplication,
    deleteCdtApplication,
} = require('../db');
const {
    CDT_APPLICATIONS_CHANNEL_ID,
    MAKES_COOL_THINGS_ROLE_ID,
} = require('../config/constants');

const SUBTITLE = 'Community Design Team Application';
const PROGRAM = 'Community Design Team';
const isYes = (value) => value.trim().toLowerCase().startsWith('y');

const isHttpUrl = (value) => {
    let url;
    try {
        url = new URL(value.trim());
    } catch {
        return false;
    }
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.includes('.');
};

const handleCdtApplicationSubmission = async (interaction) => {
    try {
        const discordId = interaction.user.id;

        await ensureCdtApplicationsTable();

        const existingRows = await findCdtApplication(discordId);
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

        if (member.roles.cache.has(MAKES_COOL_THINGS_ROLE_ID)) {
            await interaction.reply({
                ...noticePayload(
                    'You are already a Community Design Team member and cannot submit another application.',
                    { title: 'Already a Team Member', subtitle: SUBTITLE }
                ),
                ephemeral: true,
            });
            return;
        }

        let ingameName, challengeHistory, noAi, motivation, portfolioLink;
        try {
            ingameName = interaction.fields.getTextInputValue('cdtIgn');
            challengeHistory = interaction.fields.getTextInputValue('cdtChallengeHistory');
            noAi = isYes(interaction.fields.getTextInputValue('cdtNoAi'));
            motivation = interaction.fields.getTextInputValue('cdtMotivation');
            portfolioLink = interaction.fields.getTextInputValue('cdtPortfolioLink');
        } catch (error) {
            logger.error('Error parsing CDT application fields:', error);
            await interaction.reply({
                ...noticePayload(
                    'There was an issue processing your form submission.',
                    { title: 'Form Error', subtitle: SUBTITLE }
                ),
                ephemeral: true,
            });
            return;
        }

        if (!isHttpUrl(portfolioLink)) {
            await interaction.reply({
                ...noticePayload(
                    'The design examples link must be a full URL (starting with http:// or https://). Please apply again with a valid link.',
                    { title: 'Invalid Portfolio Link', subtitle: SUBTITLE }
                ),
                ephemeral: true,
            });
            return;
        }

        const applicationsChannel = interaction.guild.channels.cache.get(CDT_APPLICATIONS_CHANNEL_ID);
        if (!applicationsChannel) {
            logger.error(`Channel with ID '${CDT_APPLICATIONS_CHANNEL_ID}' not found.`);
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
            title: 'New Community Design Team Application',
            subtitle: member.user.tag,
            lines: [
                `**Applicant:** <@${discordId}>`,
                `**In-game name:** ${ingameName}`,
                `**Design Challenge history:** ${challengeHistory}`,
                `**Works without AI generative tools:** ${noAi ? 'Yes' : 'No'}`,
                `**Why CDT:** ${motivation || 'Not provided'}`,
                `**Design examples:** ${portfolioLink}`,
            ],
        });
        if (block) applicationContainer.addTextDisplayComponents(block);

        const approveButton = new ButtonBuilder()
            .setCustomId(`cdtApprove_${discordId}`)
            .setLabel('Accept')
            .setStyle(ButtonStyle.Success);

        const rejectButton = new ButtonBuilder()
            .setCustomId(`cdtReject_${discordId}`)
            .setLabel('Deny')
            .setStyle(ButtonStyle.Danger);

        const actionRow = new ActionRowBuilder().addComponents(approveButton, rejectButton);

        const applicationMessage = await applicationsChannel.send({
            flags: MessageFlags.IsComponentsV2,
            components: [applicationContainer, actionRow],
        });

        await insertCdtApplication({
            discordId,
            username: member.user.tag,
            ingameName,
            challengeHistory,
            noAi,
            motivation,
            portfolioLink,
            applicationUrl: applicationMessage.url,
        });

        await interaction.reply({
            ...noticePayload(
                'Thank you for submitting your Community Design Team application!',
                { title: 'Application Submitted', subtitle: SUBTITLE }
            ),
            ephemeral: true,
        });
    } catch (error) {
        logger.error('Unexpected error in handleCdtApplicationSubmission:', error);
    }
};

const handleCdtApplicationApprove = async (interaction) => {
    try {
        await interaction.deferReply({ ephemeral: true });

        const userId = interaction.customId.split('_')[1];
        const user = await interaction.guild.members.fetch(userId);

        const designerRole = interaction.guild.roles.cache.get(MAKES_COOL_THINGS_ROLE_ID);
        if (!designerRole) {
            logger.error(`CDT role '${MAKES_COOL_THINGS_ROLE_ID}' not found in guild.`);
            await interaction.editReply({
                ...noticePayload(
                    'The Community Design Team role could not be found, so the application was left untouched.',
                    { title: 'Approval Failed', subtitle: PROGRAM }
                ),
                ephemeral: true,
            });
            return;
        }
        await user.roles.add(designerRole);

        try {
            const dmContainer = new ContainerBuilder();
            const block = buildTextBlock({
                title: 'Community Design Team Application Accepted',
                subtitle: 'Welcome to the team',
                lines: [
                    'Congratulations! Your Community Design Team application has been accepted.',
                    '',
                    'The essentials to keep your role:',
                    '- Post designs, drafts, and ideas in #community-designers. One post per design, with previews and files. Unfinished work is welcome.',
                    '- Share at least one draft, idea, or design every two weeks. If you need time off, message a team lead before the two weeks are up — notice pauses the clock.',
                    '- Everything you submit must be your own original work, made without AI generative tools.',
                    '- Your published work is released under CC BY-NC: you are always credited, and no one may use it commercially.',
                    '',
                    'If you are ever stuck, ask a team lead. Asking early is always the right call.',
                ],
            });
            if (block) dmContainer.addTextDisplayComponents(block);
            await user.send({ flags: MessageFlags.IsComponentsV2, components: [dmContainer] });
        } catch (dmError) {
            logger.error('Failed to send DM to user:', dmError.message);
        }

        await deleteCdtApplication(userId);

        const approvedContainer = new ContainerBuilder();
        const block = buildTextBlock({
            title: 'Application Accepted',
            subtitle: PROGRAM,
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
                { title: 'Application Accepted', subtitle: PROGRAM }
            ),
            ephemeral: true,
        });
    } catch (error) {
        logger.error('Error approving CDT application:', error);

        if (!interaction.replied) {
            await interaction.editReply({
                ...noticePayload(
                    'There was an error while accepting the application. Please try again later.',
                    { title: 'Approval Failed', subtitle: PROGRAM }
                ),
                ephemeral: true,
            });
        }
    }
};

const handleCdtApplicationReject = async (interaction) => {
    try {
        await interaction.deferReply({ ephemeral: true });

        const userId = interaction.customId.split('_')[1];
        const user = await interaction.guild.members.fetch(userId);

        try {
            const dmContainer = new ContainerBuilder();
            const block = buildTextBlock({
                title: 'Community Design Team Application Denied',
                subtitle: 'Application reviewed',
                lines: ['Unfortunately, your Community Design Team application has been denied. You are welcome to apply again in the future.'],
            });
            if (block) dmContainer.addTextDisplayComponents(block);
            await user.send({ flags: MessageFlags.IsComponentsV2, components: [dmContainer] });
        } catch (dmError) {
            logger.error('Failed to send DM to user:', dmError.message);
        }

        await deleteCdtApplication(userId);

        const rejectedContainer = new ContainerBuilder();
        const block = buildTextBlock({
            title: 'Application Denied',
            subtitle: PROGRAM,
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
                { title: 'Application Denied', subtitle: PROGRAM }
            ),
            ephemeral: true,
        });
    } catch (error) {
        logger.error('Error denying CDT application:', error);

        if (!interaction.replied) {
            await interaction.editReply({
                ...noticePayload(
                    'There was an error while denying the application. Please try again later.',
                    { title: 'Denial Failed', subtitle: PROGRAM }
                ),
                ephemeral: true,
            });
        }
    }
};

module.exports = {
    isHttpUrl,
    handleCdtApplicationSubmission,
    handleCdtApplicationApprove,
    handleCdtApplicationReject,
};
