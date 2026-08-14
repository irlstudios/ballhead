'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ContainerBuilder } = require('discord.js');
const logger = require('../utils/logger');
const { buildTextBlock, noticePayload } = require('../utils/ui');
const {
    ensureEmhApplicationsTable,
    findEmhApplication,
    insertEmhApplication,
    deleteEmhApplication,
} = require('../db');
const {
    EMH_APPLICATIONS_CHANNEL_ID,
    HOST_ROLE_ID,
} = require('../config/constants');

const SUBTITLE = 'EMH Application';
const isYes = (value) => value.trim().toLowerCase().startsWith('y');

const isYoutubeLink = (value) => {
    let url;
    try {
        url = new URL(value.trim());
    } catch {
        return false;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return false;
    }
    const host = url.hostname.toLowerCase();
    return host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com');
};

const handleEmhApplicationSubmission = async (interaction) => {
    try {
        const discordId = interaction.user.id;

        await ensureEmhApplicationsTable();

        const existingRows = await findEmhApplication(discordId);
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

        if (member.roles.cache.has(HOST_ROLE_ID)) {
            await interaction.reply({
                ...noticePayload(
                    'You are already an EMH and cannot submit another application.',
                    { title: 'Already an EMH', subtitle: SUBTITLE }
                ),
                ephemeral: true,
            });
            return;
        }

        let ingameName, hostingDuration, rulesRead, motivation, youtubeLink;
        try {
            ingameName = interaction.fields.getTextInputValue('emhIgn');
            hostingDuration = interaction.fields.getTextInputValue('emhHostingDuration');
            rulesRead = isYes(interaction.fields.getTextInputValue('emhRulesRead'));
            motivation = interaction.fields.getTextInputValue('emhMotivation');
            youtubeLink = interaction.fields.getTextInputValue('emhYoutubeLink');
        } catch (error) {
            logger.error('Error parsing EMH application fields:', error);
            await interaction.reply({
                ...noticePayload(
                    'There was an issue processing your form submission.',
                    { title: 'Form Error', subtitle: SUBTITLE }
                ),
                ephemeral: true,
            });
            return;
        }

        if (!isYoutubeLink(youtubeLink)) {
            await interaction.reply({
                ...noticePayload(
                    'The video link must be a full YouTube URL (youtube.com or youtu.be). Please run /apply emh again with a valid link.',
                    { title: 'Invalid YouTube Link', subtitle: SUBTITLE }
                ),
                ephemeral: true,
            });
            return;
        }

        const applicationsChannel = interaction.guild.channels.cache.get(EMH_APPLICATIONS_CHANNEL_ID);
        if (!applicationsChannel) {
            logger.error(`Channel with ID '${EMH_APPLICATIONS_CHANNEL_ID}' not found.`);
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
            title: 'New EMH Application',
            subtitle: member.user.tag,
            lines: [
                `**Applicant:** <@${discordId}>`,
                `**In-game name:** ${ingameName}`,
                `**Hosting Mini-Games for:** ${hostingDuration}`,
                `**Read/understands the EMH rules:** ${rulesRead ? 'Yes' : 'No'}`,
                `**Why EMH:** ${motivation || 'Not provided'}`,
                `**Most recent hosted Mini-Game:** ${youtubeLink}`,
            ],
        });
        if (block) applicationContainer.addTextDisplayComponents(block);

        const approveButton = new ButtonBuilder()
            .setCustomId(`emhApprove_${discordId}`)
            .setLabel('Accept')
            .setStyle(ButtonStyle.Success);

        const rejectButton = new ButtonBuilder()
            .setCustomId(`emhReject_${discordId}`)
            .setLabel('Deny')
            .setStyle(ButtonStyle.Danger);

        const actionRow = new ActionRowBuilder().addComponents(approveButton, rejectButton);

        const applicationMessage = await applicationsChannel.send({
            flags: MessageFlags.IsComponentsV2,
            components: [applicationContainer, actionRow],
        });

        await insertEmhApplication({
            discordId,
            username: member.user.tag,
            ingameName,
            hostingDuration,
            rulesRead,
            motivation,
            youtubeLink,
            applicationUrl: applicationMessage.url,
        });

        await interaction.reply({
            ...noticePayload(
                'Thank you for submitting your EMH application!',
                { title: 'Application Submitted', subtitle: SUBTITLE }
            ),
            ephemeral: true,
        });
    } catch (error) {
        logger.error('Unexpected error in handleEmhApplicationSubmission:', error);
    }
};

const handleEmhApplicationApprove = async (interaction) => {
    try {
        await interaction.deferReply({ ephemeral: true });

        const userId = interaction.customId.split('_')[1];
        const user = await interaction.guild.members.fetch(userId);

        const hostRole = interaction.guild.roles.cache.get(HOST_ROLE_ID);
        if (!hostRole) {
            logger.error(`EMH host role '${HOST_ROLE_ID}' not found in guild.`);
            await interaction.editReply({
                ...noticePayload(
                    'The EMH host role could not be found, so the application was left untouched.',
                    { title: 'Approval Failed', subtitle: 'EMH Program' }
                ),
                ephemeral: true,
            });
            return;
        }
        await user.roles.add(hostRole);

        try {
            const dmContainer = new ContainerBuilder();
            const block = buildTextBlock({
                title: 'EMH Application Accepted',
                subtitle: 'Event Host role granted',
                lines: [
                    'Congratulations! Your EMH application has been accepted.',
                    '',
                    'Start here — this guide explains everything you need to know as an EMH, including what to do and how to do it:',
                    'https://docs.google.com/document/d/15flVB_aLv-Lb1z-1Nb_ZlhGSRzGkzotwW1ZXWo9zyuA/edit?tab=t.0',
                ],
            });
            if (block) dmContainer.addTextDisplayComponents(block);
            await user.send({ flags: MessageFlags.IsComponentsV2, components: [dmContainer] });
        } catch (dmError) {
            logger.error('Failed to send DM to user:', dmError.message);
        }

        await deleteEmhApplication(userId);

        const approvedContainer = new ContainerBuilder();
        const block = buildTextBlock({
            title: 'Application Accepted',
            subtitle: 'EMH Program',
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
                { title: 'Application Accepted', subtitle: 'EMH Program' }
            ),
            ephemeral: true,
        });
    } catch (error) {
        logger.error('Error approving EMH application:', error);

        if (!interaction.replied) {
            await interaction.editReply({
                ...noticePayload(
                    'There was an error while accepting the application. Please try again later.',
                    { title: 'Approval Failed', subtitle: 'EMH Program' }
                ),
                ephemeral: true,
            });
        }
    }
};

const handleEmhApplicationReject = async (interaction) => {
    try {
        await interaction.deferReply({ ephemeral: true });

        const userId = interaction.customId.split('_')[1];
        const user = await interaction.guild.members.fetch(userId);

        try {
            const dmContainer = new ContainerBuilder();
            const block = buildTextBlock({
                title: 'EMH Application Denied',
                subtitle: 'Application reviewed',
                lines: ['Unfortunately, your EMH application has been denied. You are welcome to apply again in the future.'],
            });
            if (block) dmContainer.addTextDisplayComponents(block);
            await user.send({ flags: MessageFlags.IsComponentsV2, components: [dmContainer] });
        } catch (dmError) {
            logger.error('Failed to send DM to user:', dmError.message);
        }

        await deleteEmhApplication(userId);

        const rejectedContainer = new ContainerBuilder();
        const block = buildTextBlock({
            title: 'Application Denied',
            subtitle: 'EMH Program',
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
                { title: 'Application Denied', subtitle: 'EMH Program' }
            ),
            ephemeral: true,
        });
    } catch (error) {
        logger.error('Error denying EMH application:', error);

        if (!interaction.replied) {
            await interaction.editReply({
                ...noticePayload(
                    'There was an error while denying the application. Please try again later.',
                    { title: 'Denial Failed', subtitle: 'EMH Program' }
                ),
                ephemeral: true,
            });
        }
    }
};

module.exports = {
    isYoutubeLink,
    handleEmhApplicationSubmission,
    handleEmhApplicationApprove,
    handleEmhApplicationReject,
};
