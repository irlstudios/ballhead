'use strict';

const { MessageFlags, ContainerBuilder } = require('discord.js');
const logger = require('../utils/logger');
const { buildTextBlock, noticePayload } = require('../utils/ui');
const { getSheetsClient } = require('../utils/sheets_cache');
const { SPREADSHEET_KO_HOST, SPREADSHEET_RANKED_SESSIONS, KO_HOST_APPLICATIONS_CHANNEL_ID } = require('../config/constants');

const handleBugReport = async (interaction, customId) => {
    const commandName = customId;
    const errorReceived = interaction.fields.getTextInputValue('bug-error');
    const steps = interaction.fields.getTextInputValue('bug-steps');

    const { GYM_CLASS_GUILD_ID, USER_BUG_REPORTS_CHANNEL_ID, BOT_BUGS_CHANNEL_ID } = require('../config/constants');

    const logContainer = new ContainerBuilder();
    const block = buildTextBlock({
        title: 'Bug Report',
        subtitle: `Command: ${commandName}`,
        lines: [
            `**Reported By:** <@${interaction.user.id}>`,
            `**Error Received:** ${errorReceived}`,
            `**Steps to Reproduce:** ${steps || 'Not provided'}`,
        ],
    });
    if (block) logContainer.addTextDisplayComponents(block);

    try {
        const loggingGuild = await interaction.client.guilds.fetch(GYM_CLASS_GUILD_ID);
        const loggingChannel = await loggingGuild.channels.fetch(USER_BUG_REPORTS_CHANNEL_ID);
        await loggingChannel.send({ flags: MessageFlags.IsComponentsV2, components: [logContainer] });
        await interaction.reply({
            ...noticePayload('Thank you for reporting the bug. The development team has been notified.', { title: 'Bug Report Received', subtitle: 'Thanks for helping' }),
            ephemeral: true,
        });
    } catch (error) {
        logger.error('Failed to log bug report:', error);
        await interaction.reply({
            ...noticePayload(
                'Ironically.... There was an error logging your bug report the developers have been notified \n-# if this issue persists please reach out to support to escalate your issue.',
                { title: 'Bug Report Error', subtitle: 'Logging Failed' }
            ),
            ephemeral: true,
        });

        try {
            const errorGuild = await interaction.client.guilds.fetch(GYM_CLASS_GUILD_ID);
            const errorChannel = await errorGuild.channels.fetch(BOT_BUGS_CHANNEL_ID);
            const errorContainer = new ContainerBuilder();
            const errBlock = buildTextBlock({
                title: 'Bug Report Logging Failed',
                subtitle: 'Unable to notify devs',
                lines: [`An error occurred while logging a bug report: ${error.message}`],
            });
            if (errBlock) errorContainer.addTextDisplayComponents(errBlock);
            await errorChannel.send({ flags: MessageFlags.IsComponentsV2, components: [errorContainer] });
        } catch (logError) {
            logger.error('Failed to log error:', logError);
        }
    }
};

const handleSnackModal = async (interaction) => {
    try {
        const snackValues = interaction.fields.getStringSelectValues('favorite_snack');
        const snack = snackValues && snackValues.length > 0 ? snackValues[0] : 'Unknown';
        const reason = interaction.fields.getTextInputValue('reason_input');

        await interaction.reply({
            ...noticePayload(
                [`**Snack:** ${snack}`, `**Reason:** ${reason}`],
                { title: 'Snack Selected', subtitle: 'Modal Test' }
            ),
            ephemeral: true,
        });
    } catch (error) {
        logger.error('Error handling snack modal:', error);
        await interaction.reply({
            ...noticePayload('Could not read your selections from the modal.', { title: 'Modal Error', subtitle: 'Snack Modal' }),
            ephemeral: true,
        });
    }
};

const handleKoHostApplication = async (interaction) => {
    try {
        const reason = interaction.fields.getTextInputValue('koHostReason');
        const availability = interaction.fields.getTextInputValue('koHostAvailability');
        const boxingAwareness = interaction.fields.getTextInputValue('koHostBoxingAwareness');
        const guidelineAgreement = interaction.fields.getTextInputValue('koHostGuidelineAgreement');

        const normalizeYesNo = (input) => input?.trim().toLowerCase();
        const boxingNormalized = normalizeYesNo(boxingAwareness);
        const guidelineNormalized = normalizeYesNo(guidelineAgreement);

        const invalidFields = [];
        if (boxingNormalized !== 'yes' && boxingNormalized !== 'no') invalidFields.push('Boxing operations/rules');
        if (guidelineNormalized !== 'yes' && guidelineNormalized !== 'no') invalidFields.push('Guideline agreement');

        if (invalidFields.length) {
            await interaction.reply({
                ...noticePayload(`Please answer "Yes" or "No" for: ${invalidFields.join(', ')}.`, { title: 'Validation Required', subtitle: 'KO-Host Application' }),
                ephemeral: true,
            });
            return;
        }

        const applicationsChannel = await interaction.client.channels.fetch(KO_HOST_APPLICATIONS_CHANNEL_ID).catch(() => null);
        if (!applicationsChannel) {
            await interaction.reply({
                ...noticePayload('Could not find the KO-Host applications channel. Please alert a staff member.', { title: 'Submission Failed', subtitle: 'KO-Host Application' }),
                ephemeral: true,
            });
            return;
        }

        const koHostContainer = new ContainerBuilder();
        const block = buildTextBlock({
            title: 'New KO-Host Application',
            subtitle: interaction.user.tag,
            lines: [
                `**Applicant:** <@${interaction.user.id}> (${interaction.user.tag})`,
                `**Why do you want to become a KO-Host?** ${reason || 'Not provided'}`,
                `**Availability:** ${availability || 'Not provided'}`,
                `**Boxing Knowledge:** ${boxingNormalized === 'yes' ? 'Yes' : 'No'}`,
                `**Guideline Agreement:** ${guidelineNormalized === 'yes' ? 'Yes' : 'No'}`,
            ],
        });
        if (block) koHostContainer.addTextDisplayComponents(block);

        const applicationMessage = await applicationsChannel.send({ flags: MessageFlags.IsComponentsV2, components: [koHostContainer] });

        try {
            const sheets = await getSheetsClient();
            await sheets.spreadsheets.values.append({
                spreadsheetId: SPREADSHEET_KO_HOST,
                range: 'Applications!A:E',
                valueInputOption: 'USER_ENTERED',
                resource: {
                    values: [[
                        interaction.user.tag, interaction.user.id,
                        guidelineNormalized === 'yes' ? 'Yes' : 'No',
                        applicationMessage?.url || 'Not available', 'Pending',
                    ]],
                },
            });
        } catch (sheetError) {
            logger.error('Failed to write KO-Host application to sheet:', sheetError);
        }

        await interaction.reply({
            ...noticePayload('Thank you! Your KO-Host application has been submitted.', { title: 'Application Submitted', subtitle: 'KO-Host Application' }),
            ephemeral: true,
        });
    } catch (error) {
        logger.error('Error handling KO-Host application modal:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                ...noticePayload('There was an error submitting your application. Please try again later.', { title: 'Submission Failed', subtitle: 'KO-Host Application' }),
                ephemeral: true,
            }).catch(e => logger.error('Reply failed:', e));
        }
    }
};

const SKILL_LABELS = Object.freeze({
    'midrange_one_dribble_jump_shot_freethrow': 'Midrange One Dribble Jump Shot (Freethrow)',
    'midrange_catch_and_shoot_jumpshot_freethrow': 'Midrange Catch and Shoot Jumpshot (Freethrow)',
    'midrange_one_dribble_jump_shot_right_elbow': 'Midrange One Dribble Jump Shot (Right Elbow)',
    'midrange_one_dribble_jump_shot_left_elbow': 'Midrange One Dribble Jump shot (Left Elbow)',
    'perimeter_catch_and_shoot_top_key': 'Perimeter Catch and Shoot (Top of The key)',
    'perimeter_one_dribble_jump_shot_top_key': 'Perimeter One Dribble Jump Shot (Top of The key)',
});

const handleRankedSessionModal = async (interaction) => {
    try {
        const coachName = interaction.fields.getTextInputValue('coachName');
        const participantsName = interaction.fields.getTextInputValue('participantsName').trim();
        if (!participantsName) {
            await interaction.reply({
                ...noticePayload('Please include participant names for the session.', { title: 'Missing Participants' }),
                ephemeral: true,
            });
            return;
        }

        const madeAttempts = interaction.fields.getTextInputValue('madeAttempts');
        const rankSkill = interaction.fields.getStringSelectValues('rankSkill')[0];
        const passFail = interaction.fields.getStringSelectValues('passFail')[0];

        const attemptsNum = parseInt(madeAttempts, 10);
        if (isNaN(attemptsNum) || attemptsNum < 0 || attemptsNum > 10) {
            await interaction.reply({
                ...noticePayload('Made Attempts must be a number between 0 and 10.', { title: 'Invalid Attempts' }),
                ephemeral: true,
            });
            return;
        }

        const skillLabel = SKILL_LABELS[rankSkill] || rankSkill;
        const passFailLabel = passFail === 'pass' ? 'Pass' : 'Fail';
        const sessionId = `RS-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

        try {
            const sheets = await getSheetsClient();
            const currentDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });

            await sheets.spreadsheets.values.append({
                spreadsheetId: SPREADSHEET_RANKED_SESSIONS,
                range: 'Log!A:H',
                valueInputOption: 'USER_ENTERED',
                resource: {
                    values: [[sessionId, currentDate, coachName, participantsName, skillLabel, madeAttempts, passFailLabel, '']],
                },
            });

            let dmDelivered = true;
            try {
                const dmContainer = new ContainerBuilder();
                const block = buildTextBlock({
                    title: 'Ranked Session Logged',
                    subtitle: 'Copy your session ID',
                    lines: [
                        'Your ranked session was logged successfully.',
                        'How to copy on mobile:',
                        '1) Press and hold the next message.',
                        '2) Tap Copy Text.',
                        '3) Paste it into `/ranked-session-best`.',
                        '.. your session id is:',
                    ],
                });
                if (block) dmContainer.addTextDisplayComponents(block);
                await interaction.user.send({ flags: MessageFlags.IsComponentsV2, components: [dmContainer] });
                await interaction.user.send({ content: `\`${sessionId}\`` });
            } catch (dmError) {
                dmDelivered = false;
                logger.error('Failed to DM session ID:', dmError);
            }

            const replyLines = [
                'Ranked session logged successfully!',
                `**Session ID:** ${sessionId}`,
                'Use `/ranked-session-best` to log the best participant.',
            ];
            if (!dmDelivered) {
                replyLines.push('I could not DM you, so please copy the session ID from this message.');
            }

            await interaction.reply({
                ...noticePayload(replyLines, { title: 'Session Logged' }),
                ephemeral: true,
            });
        } catch (sheetError) {
            logger.error('Failed to write ranked session to sheet:', sheetError);
            await interaction.reply({
                ...noticePayload('There was an error logging the session. Please try again later.', { title: 'Logging Failed' }),
                ephemeral: true,
            });
        }
    } catch (error) {
        logger.error('Error handling ranked session modal:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                ...noticePayload('There was an error submitting the ranked session. Please try again later.', { title: 'Submission Failed' }),
                ephemeral: true,
            }).catch(e => logger.error('Reply failed:', e));
        }
    }
};

const handleGenerateTemplateModal = async (interaction) => {
    const type = interaction.customId.includes('kotc') ? 'kotc' : 'gc_officials';

    const inGameName = interaction.fields.getTextInputValue('ingamename');
    const gameMode = interaction.fields.getTextInputValue('gamemode');
    const courtName = interaction.fields.getTextInputValue('courtname');
    const ruleSet = type === 'gc_officials' ? interaction.fields.getTextInputValue('ruleset') : null;

    await interaction.reply({
        ...noticePayload('One moment while we generate your template!', { title: 'Template Generator', subtitle: 'Preparing Template' }),
        ephemeral: true,
    });

    let templateMessage;
    if (type === 'kotc') {
        templateMessage = `Hey @KOTC Player I'm hosting a Friendly Fire KOTC Lobby right now!\n\nGame mode is hosted using the https://discord.com/channels/752216589792706621/1286079900196798515 Ruleset!\n\n## Here is how to join\n- Go to <#879142306932981800>\n- Use the /followplayer [${inGameName}] commands and follow ${inGameName}\n- Come join my in-game court with the name ${courtName}\n- Game Mode: ${gameMode}`;
    } else {
        templateMessage = `Hey @Looking for Games I'm hosting an officials lobby right now!\n\nGame modes are hosted using the ${ruleSet} Ruleset!\n\n## Here is how to join\n- Go to <#879142306932981800>\n- Use the /followplayer [${inGameName}] commands and follow ${inGameName}\n- Come join my in-game court with the name ${courtName}\n- Game Mode: ${gameMode}`;
    }

    try {
        await interaction.user.send(templateMessage);
        await interaction.editReply(
            noticePayload('Your template was generated and sent to your DMs!', { title: 'Template Delivered', subtitle: 'Template Generator' })
        );
    } catch (error) {
        logger.error(`Failed to send DM to ${interaction.user.tag}: ${error.message}`);
        await interaction.editReply(
            noticePayload('Your template was generated, but I could not send it to your DMs. Please ensure your DMs are open and try again!', { title: 'DM Failed', subtitle: 'Template Generator' })
        );
    }
};

module.exports = {
    handleBugReport,
    handleSnackModal,
    handleKoHostApplication,
    handleRankedSessionModal,
    handleGenerateTemplateModal,
};
