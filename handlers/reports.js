'use strict';

const { MessageFlags, ContainerBuilder, PermissionsBitField } = require('discord.js');
const logger = require('../utils/logger');
const { buildTextBlock, noticePayload } = require('../utils/ui');

const handleReportApprove = async (interaction) => {
    try {
        await interaction.deferReply({ ephemeral: true });

        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
            await interaction.editReply({
                ...noticePayload('You do not have permission to action reports.', { title: 'Permission Denied', subtitle: 'Player Reports' }),
            });
            return;
        }

        const reporterId = interaction.customId.split('_')[1];

        try {
            const member = await interaction.guild.members.fetch(reporterId);
            const dmContainer = new ContainerBuilder();
            const block = buildTextBlock({
                title: 'Report Approved',
                subtitle: 'Player Report',
                lines: [
                    'Your report has been approved.',
                    'Thank you for helping keep the community safe.',
                    'Appropriate action (such as a ban or moderation review) will be handled swiftly.',
                ],
            });
            if (block) dmContainer.addTextDisplayComponents(block);
            await member.send({ flags: MessageFlags.IsComponentsV2, components: [dmContainer] });
        } catch (dmError) {
            logger.error('Failed to send report approval DM:', dmError.message);
        }

        const existingComponents = interaction.message.components
            .filter(c => c.type !== 1)
            .map(c => c.toJSON());

        const statusContainer = new ContainerBuilder();
        const block = buildTextBlock({
            title: 'Report Approved',
            subtitle: 'Player Report',
            lines: [`This report has been approved by <@${interaction.user.id}>.`],
        });
        if (block) statusContainer.addTextDisplayComponents(block);

        await interaction.message.edit({
            flags: MessageFlags.IsComponentsV2,
            components: [...existingComponents, statusContainer],
        });

        await interaction.editReply({
            ...noticePayload('The report has been approved.', { title: 'Report Approved', subtitle: 'Player Report' }),
        });
    } catch (error) {
        logger.error('Error approving report:', error);

        if (!interaction.replied) {
            await interaction.editReply({
                ...noticePayload('There was an error while approving the report. Please try again later.', { title: 'Approval Failed', subtitle: 'Player Reports' }),
            });
        }
    }
};

const handleReportDeny = async (interaction) => {
    try {
        await interaction.deferReply({ ephemeral: true });

        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
            await interaction.editReply({
                ...noticePayload('You do not have permission to action reports.', { title: 'Permission Denied', subtitle: 'Player Reports' }),
            });
            return;
        }

        const reporterId = interaction.customId.split('_')[1];

        try {
            const member = await interaction.guild.members.fetch(reporterId);
            const dmContainer = new ContainerBuilder();
            const block = buildTextBlock({
                title: 'Report Denied',
                subtitle: 'Player Report',
                lines: [
                    'Your report has been denied.',
                    'It did not meet our current moderation guidelines or lacked sufficient evidence.',
                ],
            });
            if (block) dmContainer.addTextDisplayComponents(block);
            await member.send({ flags: MessageFlags.IsComponentsV2, components: [dmContainer] });
        } catch (dmError) {
            logger.error('Failed to send report denial DM:', dmError.message);
        }

        const existingComponents = interaction.message.components
            .filter(c => c.type !== 1)
            .map(c => c.toJSON());

        const statusContainer = new ContainerBuilder();
        const block = buildTextBlock({
            title: 'Report Denied',
            subtitle: 'Player Report',
            lines: [`This report has been denied by <@${interaction.user.id}>.`],
        });
        if (block) statusContainer.addTextDisplayComponents(block);

        await interaction.message.edit({
            flags: MessageFlags.IsComponentsV2,
            components: [...existingComponents, statusContainer],
        });

        await interaction.editReply({
            ...noticePayload('The report has been denied.', { title: 'Report Denied', subtitle: 'Player Report' }),
        });
    } catch (error) {
        logger.error('Error denying report:', error);

        if (!interaction.replied) {
            await interaction.editReply({
                ...noticePayload('There was an error while denying the report. Please try again later.', { title: 'Denial Failed', subtitle: 'Player Reports' }),
            });
        }
    }
};

const handleReportInfo = async (interaction) => {
    try {
        await interaction.deferReply({ ephemeral: true });

        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
            await interaction.editReply({
                ...noticePayload('You do not have permission to action reports.', { title: 'Permission Denied', subtitle: 'Player Reports' }),
            });
            return;
        }

        const reporterId = interaction.customId.split('_')[1];

        try {
            const member = await interaction.guild.members.fetch(reporterId);
            const dmContainer = new ContainerBuilder();
            const block = buildTextBlock({
                title: 'More Information Needed',
                subtitle: 'Player Report',
                lines: [
                    'Your report requires additional information.',
                    'Please open a support ticket so our team can follow up and gather more details.',
                ],
            });
            if (block) dmContainer.addTextDisplayComponents(block);
            await member.send({ flags: MessageFlags.IsComponentsV2, components: [dmContainer] });
        } catch (dmError) {
            logger.error('Failed to send report info request DM:', dmError.message);
        }

        const existingComponents = interaction.message.components
            .filter(c => c.type !== 1)
            .map(c => c.toJSON());

        const statusContainer = new ContainerBuilder();
        const block = buildTextBlock({
            title: 'More Information Requested',
            subtitle: 'Player Report',
            lines: [`More information requested by <@${interaction.user.id}>.`],
        });
        if (block) statusContainer.addTextDisplayComponents(block);

        await interaction.message.edit({
            flags: MessageFlags.IsComponentsV2,
            components: [...existingComponents, statusContainer],
        });

        await interaction.editReply({
            ...noticePayload('The reporter has been asked for more information.', { title: 'Info Requested', subtitle: 'Player Report' }),
        });
    } catch (error) {
        logger.error('Error requesting more info for report:', error);

        if (!interaction.replied) {
            await interaction.editReply({
                ...noticePayload('There was an error while requesting more information. Please try again later.', { title: 'Request Failed', subtitle: 'Player Reports' }),
            });
        }
    }
};

module.exports = {
    handleReportApprove,
    handleReportDeny,
    handleReportInfo,
};
