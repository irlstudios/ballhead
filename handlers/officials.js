'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ContainerBuilder, PermissionsBitField } = require('discord.js');
const logger = require('../utils/logger');
const { buildTextBlock, noticePayload } = require('../utils/ui');
const { getSheetsClient } = require('../utils/sheets_cache');
const {
    findOfficialApplication,
    insertOfficialApplication,
    deleteOfficialApplication,
} = require('../db');
const {
    OFFICIALS_APPLICATIONS_CHANNEL_ID,
    OFFICIAL_ROLE_IDS,
    OFFICIAL_PROSPECT_ROLE_ID,
    SPREADSHEET_OFFICIALS,
} = require('../config/constants');

const handleOfficialsApplicationSubmission = async (interaction) => {
    try {
        const discordId = interaction.user.id;

        const existingRows = await findOfficialApplication(discordId);

        if (existingRows.length > 0) {
            await interaction.reply({
                ...noticePayload(
                    'You have already submitted an application. Please wait for it to be reviewed.',
                    { title: 'Application Already Submitted', subtitle: 'Officials Application' }
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
                    { title: 'Member Lookup Failed', subtitle: 'Officials Application' }
                ),
                ephemeral: true,
            });
            return;
        }

        if (OFFICIAL_ROLE_IDS.some(roleId => member.roles.cache.has(roleId))) {
            await interaction.reply({
                ...noticePayload(
                    'You already have an official role and cannot submit another application.',
                    { title: 'Already an Official', subtitle: 'Officials Application' }
                ),
                ephemeral: true,
            });
            return;
        }

        const sheets = await getSheetsClient();

        let agreedToRules, understandsConsequences, inGameUsername;
        try {
            agreedToRules = interaction.fields.getTextInputValue('agreement').toLowerCase() === 'yes';
            understandsConsequences = interaction.fields.getTextInputValue('banAwareness').toLowerCase() === 'yes';
            inGameUsername = interaction.fields.getTextInputValue('username');
        } catch (error) {
            logger.error('Error parsing interaction fields:', error);
            await interaction.reply({
                ...noticePayload(
                    'There was an issue processing your form submission.',
                    { title: 'Form Error', subtitle: 'Officials Application' }
                ),
                ephemeral: true,
            });
            return;
        }

        const now = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });
        const applicationsChannel = interaction.guild.channels.cache.get(OFFICIALS_APPLICATIONS_CHANNEL_ID);
        if (!applicationsChannel) {
            logger.error(`Channel with ID '${OFFICIALS_APPLICATIONS_CHANNEL_ID}' not found.`);
            await interaction.reply({
                ...noticePayload(
                    'There was an issue submitting your application.',
                    { title: 'Submission Failed', subtitle: 'Officials Application' }
                ),
                ephemeral: true,
            });
            return;
        }

        const applicationContainer = new ContainerBuilder();
        const block = buildTextBlock({
            title: 'New Official Application',
            subtitle: member.user.tag,
            lines: [
                `**In-Game Username:** ${inGameUsername || 'Not provided'}`,
                `**Agreed to Rules:** ${agreedToRules ? 'Yes' : 'No'}`,
                `**Understands Consequences:** ${understandsConsequences ? 'Yes' : 'No'}`,
            ],
        });
        if (block) applicationContainer.addTextDisplayComponents(block);

        const approveButton = new ButtonBuilder()
            .setCustomId(`approve_${discordId}`)
            .setLabel('Approve')
            .setStyle(ButtonStyle.Success);

        const rejectButton = new ButtonBuilder()
            .setCustomId(`reject_${discordId}`)
            .setLabel('Reject')
            .setStyle(ButtonStyle.Danger);

        const actionRow = new ActionRowBuilder().addComponents(approveButton, rejectButton);

        const applicationMessage = await applicationsChannel.send({
            flags: MessageFlags.IsComponentsV2,
            components: [applicationContainer, actionRow],
        });

        const applicationUrl = applicationMessage.url;
        await insertOfficialApplication(discordId, member.user.tag, inGameUsername, agreedToRules, understandsConsequences, applicationUrl);

        try {
            await sheets.spreadsheets.values.append({
                spreadsheetId: SPREADSHEET_OFFICIALS,
                range: 'Application!A:F',
                valueInputOption: 'USER_ENTERED',
                resource: {
                    values: [[member.user.tag, discordId, inGameUsername, applicationUrl, now, 'Pending']],
                },
            });
        } catch (error) {
            logger.error('Error writing to Google Sheets:', error);
        }

        await interaction.reply({
            ...noticePayload(
                'Thank you for submitting your application!',
                { title: 'Application Submitted', subtitle: 'Officials Application' }
            ),
            ephemeral: true,
        });
    } catch (error) {
        logger.error('Unexpected error in handleOfficialsApplicationSubmission:', error);
    }
};

const updateOfficialApplicationStatus = async (sheets, applicationUrl, newStatus) => {
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_OFFICIALS,
        range: 'Application!A:F',
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) {
        throw new Error('No data found in the sheet.');
    }

    const rowIndex = rows.findIndex(row => row[3] === applicationUrl);
    if (rowIndex === -1) {
        throw new Error('Application URL not found in the sheet.');
    }

    await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_OFFICIALS,
        range: `Application!F${rowIndex + 1}`,
        valueInputOption: 'RAW',
        resource: { values: [[newStatus]] },
    });

    logger.info(`Official application status updated to "${newStatus}" in Google Sheets.`);
};

const handleOfficialsApplicationApprove = async (interaction) => {
    try {
        await interaction.deferReply({ ephemeral: true });

        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
            await interaction.editReply({
                ...noticePayload('You do not have permission to approve applications.', { title: 'Permission Denied', subtitle: 'Officials Program' }),
                ephemeral: true,
            });
            return;
        }

        const userId = interaction.customId.split('_')[1];
        const user = await interaction.guild.members.fetch(userId);

        const qaButton = new ButtonBuilder()
            .setCustomId('officialsQna')
            .setLabel('Help!')
            .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(qaButton);

        try {
            const dmContainer = new ContainerBuilder();
            const block = buildTextBlock({
                title: 'Officials Application Approved',
                subtitle: 'Official Prospect role granted',
                lines: [
                    'Your officials application has been approved.',
                    'If you are unsure what to do next, press the "Help" button below.',
                ],
            });
            if (block) dmContainer.addTextDisplayComponents(block);
            await user.send({ flags: MessageFlags.IsComponentsV2, components: [dmContainer, row] });
        } catch (dmError) {
            logger.error('Failed to send DM to user:', dmError.message);
        }

        const sheets = await getSheetsClient();
        const applicationUrl = interaction.message.url;
        await updateOfficialApplicationStatus(sheets, applicationUrl, 'Approved');

        await deleteOfficialApplication(userId);

        const approvedContainer = new ContainerBuilder();
        const block = buildTextBlock({
            title: 'Application Approved',
            subtitle: 'Officials Program',
            lines: ['This application has been approved.'],
        });
        if (block) approvedContainer.addTextDisplayComponents(block);

        await interaction.message.edit({
            flags: MessageFlags.IsComponentsV2,
            components: [approvedContainer],
        });

        await interaction.editReply({
            ...noticePayload(
                'The application has been successfully approved!',
                { title: 'Application Approved', subtitle: 'Officials Program' }
            ),
            ephemeral: true,
        });

        const officialRole = interaction.guild.roles.cache.get(OFFICIAL_PROSPECT_ROLE_ID);
        await user.roles.add(officialRole);
    } catch (error) {
        logger.error('Error approving application:', error);

        if (!interaction.replied) {
            await interaction.editReply({
                ...noticePayload(
                    'There was an error while approving the application. Please try again later.',
                    { title: 'Approval Failed', subtitle: 'Officials Program' }
                ),
                ephemeral: true,
            });
        }
    }
};

const handleOfficialsApplicationReject = async (interaction) => {
    try {
        await interaction.deferReply({ ephemeral: true });

        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
            await interaction.editReply({
                ...noticePayload('You do not have permission to reject applications.', { title: 'Permission Denied', subtitle: 'Officials Program' }),
                ephemeral: true,
            });
            return;
        }

        const userId = interaction.customId.split('_')[1];
        const user = await interaction.guild.members.fetch(userId);

        const nextStepsButton = new ButtonBuilder()
            .setCustomId('officialsQnaReject')
            .setLabel('Help!')
            .setStyle(ButtonStyle.Primary);

        const actionRow = new ActionRowBuilder().addComponents(nextStepsButton);

        try {
            const dmContainer = new ContainerBuilder();
            const block = buildTextBlock({
                title: 'Officials Application Rejected',
                subtitle: 'Next steps available',
                lines: [
                    'Unfortunately, your application for officials has been rejected.',
                    'If you are confused about why, use the "Help!" button below.',
                ],
            });
            if (block) dmContainer.addTextDisplayComponents(block);
            await user.send({ flags: MessageFlags.IsComponentsV2, components: [dmContainer, actionRow] });
        } catch (dmError) {
            logger.error('Failed to send DM to user:', dmError.message);
        }

        const sheets = await getSheetsClient();
        const applicationUrl = interaction.message.url;
        await updateOfficialApplicationStatus(sheets, applicationUrl, 'Rejected');

        await deleteOfficialApplication(userId);

        const rejectedContainer = new ContainerBuilder();
        const block = buildTextBlock({
            title: 'Application Rejected',
            subtitle: 'Officials Program',
            lines: ['This application has been rejected.'],
        });
        if (block) rejectedContainer.addTextDisplayComponents(block);

        await interaction.message.edit({
            flags: MessageFlags.IsComponentsV2,
            components: [rejectedContainer],
        });

        await interaction.editReply({
            ...noticePayload(
                'The application has been successfully rejected!',
                { title: 'Application Rejected', subtitle: 'Officials Program' }
            ),
            ephemeral: true,
        });
    } catch (error) {
        logger.error('Error rejecting application:', error);

        if (!interaction.replied) {
            await interaction.editReply({
                ...noticePayload(
                    'There was an error while rejecting the application. Please try again later.',
                    { title: 'Rejection Failed', subtitle: 'Officials Program' }
                ),
                ephemeral: true,
            });
        }
    }
};

const handleQnAInteraction = async (interaction) => {
    const qaContainer = new ContainerBuilder();
    const block = buildTextBlock({
        title: 'Officials Program Q&A',
        subtitle: 'Common questions and answers',
        lines: [`**Q: What videos do I have to submit?**
A: You have to submit recordings of the full-length games with (your) mic audio included to [this form](https://docs.google.com/forms/d/13kZ__w8L8BenhbppSQc246wpHFytITy4c0PHSA995Gs).

**Q: What can I host?**
A: You can host any type of game mode (1v1, 2v2, 3v3, etc.) with any ruleset you're familiar with.

**Q: How do I move up to Active Officials?**
A: To move up, you need to send in 6 games or 1 hour's worth of recording while maintaining a quality rating of 3+.

**Q: How do I move up to Sr. Officials?**
A: To move up, you need to complete 8 hours worth of game sessions and you must have been hosting for 1 or more months *(consecutively)* while maintaining an average quality rating of 3+.

**Q: How do I check my quality rating, and if I meet requirements?**
A: To see said information can you can run the /officials-status command.

**Q: What's the purpose of this program?**
A: This program encourages more engagement with the game by increasing hosting opportunities.

**Q: What rewards will I receive?**
A: Active officials receive the official skin & glasses. Senior officials get the Sr./Lead ref skin.

If you're still confused, feel free to read-up on the [documentation](https://docs.google.com/document/d/1to-7k3EoB-bnBbzKS5zRggWLDKB8ApyLIib_a_te8TI/edit?usp=sharing).`],
    });
    if (block) qaContainer.addTextDisplayComponents(block);

    await interaction.reply({
        flags: MessageFlags.IsComponentsV2,
        components: [qaContainer],
        ephemeral: true,
    });
};

const handleNextStepsInteraction = async (interaction) => {
    const nextStepsContainer = new ContainerBuilder();
    const block = buildTextBlock({
        title: 'Why Your Application Was Rejected',
        subtitle: 'What to do next',
        lines: [
            `**Why was my application rejected?**
- **Not Meeting Requirements**: You may not have met the basic eligibility, such as being Level 5 in the Gym Class Discord or having no recent moderation logs.
- **Incomplete Application**: Missing or incomplete information in your application or not agreeing to terms and rules can result in rejection.`,
            `**What should I do next?**
1. **Meet Basic Requirements**: Ensure you meet all the basic requirements, such as no moderation logs and reaching the required level in the Discord.
2. **Complete Your Application**: When reapplying, double-check that your application is complete and all required fields are filled out.
3. **Wait If Needed**: If rejected due to moderation logs, allow at least 1 month before reapplying.`,
        ],
    });
    if (block) nextStepsContainer.addTextDisplayComponents(block);

    await interaction.reply({
        flags: MessageFlags.IsComponentsV2,
        components: [nextStepsContainer],
        ephemeral: true,
    });
};

module.exports = {
    handleOfficialsApplicationSubmission,
    handleOfficialsApplicationApprove,
    handleOfficialsApplicationReject,
    handleQnAInteraction,
    handleNextStepsInteraction,
    updateOfficialApplicationStatus,
};
