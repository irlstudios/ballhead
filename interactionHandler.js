'use strict';
require('dotenv').config({ path: './resources/.env' });
const logCommandUsage = require('./API/command-data');
const { fetchInviteById, updateInviteStatus, deleteInvite } = require('./db');
const {
    buildFriendlyFireLeaderboardPayload,
    FF_LEADERBOARD_DEFAULT_CATEGORY,
    ERROR_LOG_CHANNEL_ID: FF_LEADERBOARD_ERROR_LOG_CHANNEL_ID,
    ERROR_LOG_GUILD_ID: FF_LEADERBOARD_ERROR_LOG_GUILD_ID
} = require('./commands/friendly_fire/friendly_fire_leaderboard');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, Collection, MessageFlags, TextDisplayBuilder, ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');
const { createModal } = require('./modals/modalFactory');
const { Client } = require('pg');
const BALLHEAD_GUILD_ID = '1233740086839869501';
const axios = require('axios');

const BOT_BUGS_CHANNEL_ID = '1233853458092658749';
const USER_BUG_REPORTS_CHANNEL_ID = '1233853364035522690';
const DISCORD_BOT_TOKEN = process.env.TOKEN;
const KO_HOST_APPLICATIONS_CHANNEL_ID = '1446163192785932409';
const ITEMS_PER_PAGE = 10;

const { createCanvas, loadImage } = require('canvas');
const { request } = require('undici');

const { getSheetsClient } = require('./utils/sheets_cache');

const clientConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    database: process.env.DB_DATABASE_NAME,
    password: process.env.DB_PASSWORD,
    ssl: { rejectUnauthorized: false } };

const interactionHandler = async (interaction, client) => {
    try {
        if (interaction.isCommand()) {
            const command = client.commands.get(interaction.commandName);
            if (!command) return;
            void logCommandUsage(interaction);
            await handleCommand(interaction, client);
        } else if (interaction.isStringSelectMenu()) {
            await handleSelectMenu(interaction);
        } else if (interaction.isModalSubmit()) {
            await handleModalSubmit(interaction, client);
        } else if (interaction.isButton()) {
            await handleButton(interaction, client);
        }

    } catch (error) {
        console.error('Error handling interaction:', error);

        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                ...noticePayload(
                    'We encounter an error occurred while processing your request. \n -# if this issue persists please reach out to support to escalate your issue to the developers \n -# Do note, this error has been logged internally and will be investigated.',
                    { title: 'Request Failed', subtitle: 'Interaction Error'}
                ),
                ephemeral: true
            }).catch((err) => {
                if (err.code === 10062) {
                    console.error('Interaction expired and cannot be replied to.');
                } else {
                    console.error('Failed to reply to interaction:', err);
                }
            });
        }

        try {
            const errorGuild = await interaction.client.guilds.fetch(BALLHEAD_GUILD_ID);
            const errorChannel = await errorGuild.channels.fetch(BOT_BUGS_CHANNEL_ID);
            const errorContainer = new ContainerBuilder();
            const block = buildTextBlock({ title: 'Interaction Error',
                subtitle: 'Unhandled interaction failure', lines: [`An error occurred while processing an interaction: ${error.message}`] });
            if (block) errorContainer.addTextDisplayComponents(block);
            await errorChannel.send({ flags: MessageFlags.IsComponentsV2, components: [errorContainer] });
        } catch (logError) {
            console.error('Failed to log error:', logError);
        }
    }
};

const handleCommand = async (interaction, client) => {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    const { cooldowns } = client;

    if (!cooldowns.has(command.data.name)) {
        cooldowns.set(command.data.name, new Collection());
    }

    const now = Date.now();
    const timestamps = cooldowns.get(command.data.name);
    const defaultCooldownDuration = 5;
    const cooldownAmount = (command.cooldown ?? defaultCooldownDuration) * 1000;

    if (timestamps.has(interaction.user.id)) {
        const expirationTime = timestamps.get(interaction.user.id) + cooldownAmount;

        if (now < expirationTime) {
            const timeLeft = Math.ceil((expirationTime - now) / 1000);
            return interaction.reply({
                ...noticePayload(
                    `You are on cooldown for the \`${command.data.name}\` command. Please wait ${timeLeft} second(s) before using it again.`,
                    { title: 'Cooldown Active', subtitle: 'Command Cooldown'}
                ),
                ephemeral: true });
        }
    }

    timestamps.set(interaction.user.id, now);
    setTimeout(() => timestamps.delete(interaction.user.id), cooldownAmount);

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error('Error executing command:', error);

        if (interaction.replied || interaction.deferred) {
            await interaction.editReply({
                ...noticePayload(
                    'We encountered an error while processing the command. If this issue persists, please contact support.',
                    { title: 'Command Error', subtitle: 'Execution Failed'}
                ) }).catch((err) => {
                if (err.code === 10062) {
                    console.error('Interaction expired and cannot be edited.');
                } else {
                    console.error('Failed to edit reply:', err);
                }
            });
        } else {
            await interaction.reply({
                ...noticePayload(
                    'An error occurred while executing the command.',
                    { title: 'Command Error', subtitle: 'Execution Failed'}
                ),
                ephemeral: true }).catch((err) => {
                if (err.code === 10062) {
                    console.error('Interaction expired and cannot be replied to.');
                } else {
                    console.error('Failed to reply to an interaction:', err);
                }
            });
        }
    }
};

const handleSelectMenu = async (interaction) => {
    if (interaction.customId === 'select-platform') {
        const selectedPlatform = interaction.values[0];
        const modal = createModal(selectedPlatform);
        if (modal) {
            await interaction.showModal(modal);
        } else {
            await interaction.reply({
                ...noticePayload(
                    'We encounter an error occurred while processing your modal submission. \n -# if this issue persists please reach out to support to escalate your issue to the developers \n -# Do note, this error has been logged internally and will be investigated.',
                    { title: 'Modal Error', subtitle: 'Submission Failed'}
                ),
                ephemeral: true
            });
        }
        return;
    }
    if (interaction.customId === 'ff-leaderboard-select') {
        await handleFFLeaderboardSelect(interaction);
        return;
    }
};

const handleModalSubmit = async (interaction) => {
    const [action, customId] = interaction.customId.split(':');

    if (action === 'report-bug') {
        await handleBugReport(interaction, customId);
        return;
    }
    if (action === 'officialApplicationModal') {
        await handleOfficialsApplicationSubmission(interaction);
        return;
    }
    if (action === 'generateTemplateModal_kotc' || action === 'generateTemplateModal_gc') {
        await handleGenerateTemplateModal(interaction);
        return;
    }
    if (action === 'apply-base-league-modal') {
        await handleApplyBaseLeagueModal(interaction);
        return;
    }
    if (action === 'denyLeagueModal') {
        await handleDenyLeagueModal(interaction);
        return;
    }
    if (action === 'koHostApplicationModal') {
        await handleKoHostApplication(interaction);
        return;
    }
    if (action === 'rankedSessionModal') {
        await handleRankedSessionModal(interaction);
        return;
    }
    if (action === 'snack_modal') {
        await handleSnackModal(interaction);
        return;
    }

    console.warn('Unhandled modal action:', action);
    await interaction.reply({
        ...noticePayload(
            'This modal is not recognized.',
            { title: 'Unknown Modal', subtitle: 'Modal Submission'}
        ),
        ephemeral: true
    });
};

const handleSnackModal = async (interaction) => {
    try {
        const snackValues = interaction.fields.getStringSelectValues('favorite_snack');
        const snack = snackValues && snackValues.length > 0 ? snackValues[0] : 'Unknown';
        const reason = interaction.fields.getTextInputValue('reason_input');

        await interaction.reply({
            ...noticePayload(
                [`**Snack:** ${snack}`, `**Reason:** ${reason}`],
                { title: 'Snack Selected', subtitle: 'Modal Test'}
            ),
            ephemeral: true
        });
    } catch (error) {
        console.error('Error handling snack modal:', error);
        await interaction.reply({
            ...noticePayload(
                'Could not read your selections from the modal.',
                { title: 'Modal Error', subtitle: 'Snack Modal'}
            ),
            ephemeral: true
        });
    }
};

const handleButton = async(interaction, client) => {
    try {
        const [action, customId] = interaction.customId.split('_');
        if (!interaction.isButton() || interaction.message.partial) {
            await interaction.message.fetch();
        }
        if (action === 'invite') {
            await handleInviteButton(interaction, customId);
        } else if (action.startsWith('lfg:')) {
            await handleLfgButton(interaction);
        } else if (action === 'pagination1') {
            await handlePagination1(interaction, customId);
        } else if (action === 'next2') {
            await handleNext2(interaction, customId);
        } else if (action === 'prev2') {
            await handlePrev2(interaction, customId);
        } else if (action === 'approve') {
            await handleOfficialsApplicationApprove(interaction, client);
        } else if (action === 'reject') {
            await handleOfficialsApplicationReject(interaction, client);
        } else if (action === 'officialsQna') {
            await handleQnAInteraction(interaction);
        } else if (action === 'officialsQnaReject') {
            await handleNextStepsInteraction(interaction);
        } else if (action === 'approveLeague') {
            await handleApproveLeague(interaction);
        } else if (action === 'denyLeague') {
            await handleDenyLeagueButton (interaction);
        } else {
            await interaction.reply({
                ...noticePayload(
                    'We encounter an error occurred while processing your button interaction. \n-# if this issue persists please reach out to support to escalate your issue to the developers \n-# Do note, this error has been logged internally and will be investigated.',
                    { title: 'Button Error', subtitle: 'Interaction Failed'}
                ),
                ephemeral: true
            });
        }
    } catch (error) {
        console.error('Button Error', error);
        if (!interaction.replied) {
            await interaction.reply({
                ...noticePayload(
                    'An error occurred while processing your button interaction.',
                    { title: 'Button Error', subtitle: 'Interaction Failed'}
                ),
                ephemeral: true
            });
        }
    }
};

const handleBugReport = async (interaction, client, customId) => {
    const commandName = customId;
    const errorReceived = interaction.fields.getTextInputValue('bug-error');
    const steps = interaction.fields.getTextInputValue('bug-steps');

    const logContainer = new ContainerBuilder();
    const block = buildTextBlock({ title: 'Bug Report',
        subtitle: `Command: ${commandName}`, lines: [
        `**Reported By:** <@${interaction.user.id}>`,
        `**Error Received:** ${errorReceived}`,
        `**Steps to Reproduce:** ${steps || 'Not provided'}`
    ] });
            if (block) logContainer.addTextDisplayComponents(block);

    try {
        const loggingGuild = await interaction.client.guilds.fetch(BALLHEAD_GUILD_ID);
        const loggingChannel = await loggingGuild.channels.fetch(USER_BUG_REPORTS_CHANNEL_ID);
        await loggingChannel.send({ flags: MessageFlags.IsComponentsV2, components: [logContainer] });
        await interaction.reply({
            ...noticePayload(
                'Thank you for reporting the bug. The development team has been notified.',
                { title: 'Bug Report Received', subtitle: 'Thanks for helping'}
            ),
            ephemeral: true
        });
    } catch (error) {
        console.error('Failed to log bug report:', error);
        await interaction.reply({
            ...noticePayload(
                'Ironically.... There was an error logging your bug report the developers have been notified \n-# if this issue persists please reach out to support to escalate your issue.',
                { title: 'Bug Report Error', subtitle: 'Logging Failed'}
            ),
            ephemeral: true
        });

        try {
            const errorGuild = await interaction.client.guilds.fetch(BALLHEAD_GUILD_ID);
            const errorChannel = await errorGuild.channels.fetch(BOT_BUGS_CHANNEL_ID);
            const errorContainer = new ContainerBuilder();
            const block = buildTextBlock({ title: 'Bug Report Logging Failed',
                subtitle: 'Unable to notify devs', lines: [`An error occurred while logging a bug report: ${error.message}`] });
            if (block) errorContainer.addTextDisplayComponents(block);
            await errorChannel.send({ flags: MessageFlags.IsComponentsV2, components: [errorContainer] });
        } catch (logError) {
            console.error('Failed to log error:', logError);
        }
    }
};

const handleOfficialsApplicationSubmission = async (interaction) => {
    console.log('Running handleOfficialsApplicationSubmission');

    try {
        const discordId = interaction.user.id;
        console.log(`User ID: ${discordId}`);

        const pgClient = new Client(clientConfig);
        await pgClient.connect();
        console.log('Connected to PostgreSQL');

        const existingApplication = await pgClient.query(
            'SELECT * FROM official_applications WHERE discord_id = $1',
            [discordId]
        );
        console.log(`Checked existing applications, found: ${existingApplication.rows.length}`);

        if (existingApplication.rows.length > 0) {
            await interaction.reply({
                ...noticePayload(
                    'You have already submitted an application. Please wait for it to be reviewed.',
                    { title: 'Application Already Submitted', subtitle: 'Officials Application'}
                ),
                ephemeral: true });
            await pgClient.end();
            return;
        }

        const officialRoleIds = ['1286098187223957617', '1286098139513880648', '1286098091396698134'];
        let member;
        try {
            member = await interaction.guild.members.fetch(discordId);
            console.log(`Fetched guild member: ${member.user.tag}`);
        } catch (error) {
            console.error('Error fetching guild member:', error);
            await interaction.reply({
                ...noticePayload(
                    'Failed to fetch your member data.',
                    { title: 'Member Lookup Failed', subtitle: 'Officials Application'}
                ),
                ephemeral: true
            });
            await pgClient.end();
            return;
        }

        if (officialRoleIds.some(roleId => member.roles.cache.has(roleId))) {
            await interaction.reply({
                ...noticePayload(
                    'You already have an official role and cannot submit another application.',
                    { title: 'Already an Official', subtitle: 'Officials Application'}
                ),
                ephemeral: true });
            await pgClient.end();
            return;
        }

        const sheetID = '116zau8gWkOizH9KCboH8Xg5SjKOHR_Lc_asfaYQfMdI';
        const sheets = await getSheetsClient();

        let agreedToRules, understandsConsequences, inGameUsername;
        try {
            agreedToRules = interaction.fields.getTextInputValue('agreement').toLowerCase() === 'yes';
            understandsConsequences = interaction.fields.getTextInputValue('banAwareness').toLowerCase() === 'yes';
            inGameUsername = interaction.fields.getTextInputValue('username');
            console.log(`Parsed user input: ${agreedToRules}, ${understandsConsequences}, ${inGameUsername}`);
        } catch (error) {
            console.error('Error parsing interaction fields:', error);
            await interaction.reply({
                ...noticePayload(
                    'There was an issue processing your form submission.',
                    { title: 'Form Error', subtitle: 'Officials Application'}
                ),
                ephemeral: true
            });
            await pgClient.end();
            return;
        }

        const now = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });
        const applicationsChannel = interaction.guild.channels.cache.get('1284290923819175976');
        if (!applicationsChannel) {
            console.error('Channel with ID \'1284290923819175976\' not found.');
            await interaction.reply({
                ...noticePayload(
                    'There was an issue submitting your application.',
                    { title: 'Submission Failed', subtitle: 'Officials Application'}
                ),
                ephemeral: true
            });
            await pgClient.end();
            return;
        }

        const applicationContainer = new ContainerBuilder();
        const block = buildTextBlock({ title: 'New Official Application',
            subtitle: member.user.tag, lines: [
            `**In-Game Username:** ${inGameUsername || 'Not provided'}`,
            `**Agreed to Rules:** ${agreedToRules ? 'Yes' : 'No'}`,
            `**Understands Consequences:** ${understandsConsequences ? 'Yes' : 'No'}`
        ] });
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

        const applicationMessage = await applicationsChannel.send({ flags: MessageFlags.IsComponentsV2, components: [applicationContainer, actionRow] });
        console.log('Application message sent successfully with buttons');

        const applicationUrl = applicationMessage.url;
        await pgClient.query(
            `INSERT INTO official_applications (discord_id, discord_username, in_game_username, agreed_to_rules, understands_consequences, application_url, submitted_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
            [discordId, member.user.tag, inGameUsername, agreedToRules, understandsConsequences, applicationUrl]
        );
        console.log('Application logged to database');

        try {
            await sheets.spreadsheets.values.append({
                spreadsheetId: sheetID,
                range: 'Application!A:F',
                valueInputOption: 'USER_ENTERED',
                resource: {
                    values: [[member.user.tag, discordId, inGameUsername, applicationUrl, now, 'Pending']]
                }
            });
            console.log('Application logged to Google Sheets under Application tab');
        } catch (error) {
            console.error('Error writing to Google Sheets:', error);
        }

        await interaction.reply({
            ...noticePayload(
                'Thank you for submitting your application!',
                { title: 'Application Submitted', subtitle: 'Officials Application'}
            ),
            ephemeral: true
        });
        await pgClient.end();
        console.log('Database connection closed');
    } catch (error) {
        console.error('Unexpected error in handleOfficialsApplicationSubmission:', error);
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
                ...noticePayload(
                    `Please answer "Yes" or "No" for: ${invalidFields.join(', ')}.`,
                    { title: 'Validation Required', subtitle: 'KO-Host Application'}
                ),
                ephemeral: true
            });
            return;
        }

        const applicationsChannel = await interaction.client.channels.fetch(KO_HOST_APPLICATIONS_CHANNEL_ID).catch(() => null);
        if (!applicationsChannel) {
            await interaction.reply({
                ...noticePayload(
                    'Could not find the KO-Host applications channel. Please alert a staff member.',
                    { title: 'Submission Failed', subtitle: 'KO-Host Application'}
                ),
                ephemeral: true
            });
            return;
        }

        const koHostContainer = new ContainerBuilder();
        const block = buildTextBlock({ title: 'New KO-Host Application',
            subtitle: interaction.user.tag, lines: [
            `**Applicant:** <@${interaction.user.id}> (${interaction.user.tag })`,
            `**Why do you want to become a KO-Host?** ${reason || 'Not provided'}`,
            `**Availability:** ${availability || 'Not provided'}`,
            `**Boxing Knowledge:** ${boxingNormalized === 'yes' ? 'Yes' : 'No'}`,
            `**Guideline Agreement:** ${guidelineNormalized === 'yes' ? 'Yes' : 'No'}`
        ] });
            if (block) koHostContainer.addTextDisplayComponents(block);

        const applicationMessage = await applicationsChannel.send({ flags: MessageFlags.IsComponentsV2, components: [koHostContainer] });

        try {
            const sheets = await getSheetsClient();
            await sheets.spreadsheets.values.append({
                spreadsheetId: '1JZ6tadLFzW68OiMXQeHndyJcwU7hp_Qgh_ar0hq4-sk',
                range: 'Applications!A:E',
                valueInputOption: 'USER_ENTERED',
                resource: {
                    values: [[
                        interaction.user.tag,
                        interaction.user.id,
                        guidelineNormalized === 'yes' ? 'Yes' : 'No',
                        applicationMessage?.url || 'Not available',
                        'Pending'
                    ]]
                }
            });
        } catch (sheetError) {
            console.error('Failed to write KO-Host application to sheet:', sheetError);
        }

        await interaction.reply({
            ...noticePayload(
                'Thank you! Your KO-Host application has been submitted.',
                { title: 'Application Submitted', subtitle: 'KO-Host Application'}
            ),
            ephemeral: true
        });
    } catch (error) {
        console.error('Error handling KO-Host application modal:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                ...noticePayload(
                    'There was an error submitting your application. Please try again later.',
                    { title: 'Submission Failed', subtitle: 'KO-Host Application'}
                ),
                ephemeral: true
            }).catch(console.error);
        }
    }
};

const handleRankedSessionModal = async (interaction) => {
    try {
        const coachName = interaction.fields.getTextInputValue('coachName');
        const participantsName = interaction.fields.getTextInputValue('participantsName').trim();
        if (!participantsName) {
            await interaction.reply({
                ...noticePayload(
                    'Please include participant names for the session.',
                    { title: 'Missing Participants'}
                ),
                ephemeral: true
            });
            return;
        }

        const madeAttempts = interaction.fields.getTextInputValue('madeAttempts');
        const rankSkill = interaction.fields.getStringSelectValues('rankSkill')[0];
        const passFail = interaction.fields.getStringSelectValues('passFail')[0];

        const attemptsNum = parseInt(madeAttempts, 10);
        if (isNaN(attemptsNum) || attemptsNum < 0 || attemptsNum > 10) {
            await interaction.reply({
                ...noticePayload(
                    'Made Attempts must be a number between 0 and 10.',
                    { title: 'Invalid Attempts'}
                ),
                ephemeral: true
            });
            return;
        }

        const skillLabels = {
            'midrange_one_dribble_jump_shot_freethrow': 'Midrange One Dribble Jump Shot (Freethrow)',
            'midrange_catch_and_shoot_jumpshot_freethrow': 'Midrange Catch and Shoot Jumpshot (Freethrow)',
            'midrange_one_dribble_jump_shot_right_elbow': 'Midrange One Dribble Jump Shot (Right Elbow)',
            'midrange_one_dribble_jump_shot_left_elbow': 'Midrange One Dribble Jump shot (Left Elbow)',
            'perimeter_catch_and_shoot_top_key': 'Perimeter Catch and Shoot (Top of The key)',
            'perimeter_one_dribble_jump_shot_top_key': 'Perimeter One Dribble Jump Shot (Top of The key)' };

        const skillLabel = skillLabels[rankSkill] || rankSkill;
        const passFailLabel = passFail === 'pass' ? 'Pass' : 'Fail';

        const sessionId = `RS-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
        try {
            const sheets = await getSheetsClient();
            const currentDate = new Date().toLocaleDateString('en-US', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            });

            await sheets.spreadsheets.values.append({
                spreadsheetId: '1XQ3kY7v8IaQzjk7jmUvoaOV2OZB6gFL0DcNlRNLQ8-I',
                range: 'Log!A:H',
                valueInputOption: 'USER_ENTERED',
                resource: {
                    values: [[
                        sessionId,
                        currentDate,
                        coachName,
                        participantsName,
                        skillLabel,
                        madeAttempts,
                        passFailLabel,
                        ''
                    ]]
                }
            });

            let dmDelivered = true;
            try {
                const dmContainer = new ContainerBuilder();
                const block = buildTextBlock({ title: 'Ranked Session Logged',
                    subtitle: 'Copy your session ID', lines: [
                    'Your ranked session was logged successfully.',
                    'How to copy on mobile:',
                    '1) Press and hold the next message.',
                    '2) Tap Copy Text.',
                    '3) Paste it into `/ranked-session-best`.',
                    '.. your session id is:'
                ] });
            if (block) dmContainer.addTextDisplayComponents(block);
                await interaction.user.send({ flags: MessageFlags.IsComponentsV2, components: [dmContainer] });
                await interaction.user.send({ content: `\`${sessionId}\`` });
            } catch (dmError) {
                dmDelivered = false;
                console.error('Failed to DM session ID:', dmError);
            }

            const replyLines = [
                'Ranked session logged successfully!',
                `**Session ID:** ${sessionId}`,
                'Use `/ranked-session-best` to log the best participant.'
            ];
            if (!dmDelivered) {
                replyLines.push('I could not DM you, so please copy the session ID from this message.');
            }

            await interaction.reply({
                ...noticePayload(
                    replyLines,
                    { title: 'Session Logged'}
                ),
                ephemeral: true
            });
        } catch (sheetError) {
            console.error('Failed to write ranked session to sheet:', sheetError);
            await interaction.reply({
                ...noticePayload(
                    'There was an error logging the session. Please try again later.',
                    { title: 'Logging Failed'}
                ),
                ephemeral: true
            });
        }
    } catch (error) {
        console.error('Error handling ranked session modal:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                ...noticePayload(
                    'There was an error submitting the ranked session. Please try again later.',
                    { title: 'Submission Failed'}
                ),
                ephemeral: true
            }).catch(console.error);
        }
    }
};


const handleGenerateTemplateModal = async (interaction) => {
    const type = interaction.customId.includes('kotc') ? 'kotc' : 'gc_officials';

    const inGameName = interaction.fields.getTextInputValue('ingamename');
    const gameMode = interaction.fields.getTextInputValue('gamemode');
    const courtName = interaction.fields.getTextInputValue('courtname');
    const ruleSet = type === 'gc_officials' ? interaction.fields.getTextInputValue('ruleset') : null;

    const initialEphemeralMessage = 'One moment while we generate your template! Once generated, hold down on the message, then press Copy Text to copy the contents to your clipboard, then paste it in https://discord.com/channels/752216589792706621/987233054915428422!';

    await interaction.reply({
        ...noticePayload(
            initialEphemeralMessage,
            { title: 'Template Generator', subtitle: 'Preparing Template'}
        ),
        ephemeral: true
    });

    let templateMessage;
    if (type === 'kotc') {
        templateMessage = `Hey @KOTC Player I'm hosting a Friendly Fire KOTC Lobby right now!\n\nGame mode is hosted using the https://discord.com/channels/752216589792706621/1286079900196798515 Ruleset!\n\n## Here is how to join\n- Go to <#879142306932981800>\n- Use the /followplayer [${inGameName}] commands and follow ${inGameName}\n- Come join my in-game court with the name ${courtName}\n- Game Mode: ${gameMode}`;
    } else if (type === 'gc_officials') {
        templateMessage = `Hey @Looking for Games I’m hosting an officials lobby right now!\n\nGame modes are hosted using the ${ruleSet} Ruleset!\n\n## Here is how to join\n- Go to <#879142306932981800>\n- Use the /followplayer [${inGameName}] commands and follow ${inGameName}\n- Come join my in-game court with the name ${courtName}\n- Game Mode: ${gameMode}`;
    }

    setTimeout(async () => {
        try {
            await interaction.editReply(
                noticePayload(
                    'Your template was generated!',
                    { title: 'Template Ready', subtitle: 'Template Generator'}
                )
            );
            await interaction.user.send(templateMessage);
            await interaction.editReply(
                noticePayload(
                    'Your template was generated and sent to your DMs!',
                    { title: 'Template Delivered', subtitle: 'Template Generator'}
                )
            );
        } catch (error) {
            console.error(`Failed to send DM to ${interaction.user.tag}: ${error.message}`);
            await interaction.editReply(
                noticePayload(
                    'Your template was generated, but I could not send it to your DMs. Please ensure your DMs are open and try again!',
                    { title: 'DM Failed', subtitle: 'Template Generator'}
                )
            );
        }
    }, 8500);
};

const handleInviteButton = async (interaction, action) => {
    const mascotSquads_local = [
        { name: 'Duck Squad', roleId: '1359614680615620608' },
        { name: 'Pumpkin Squad', roleId: '1361466564292907060' },
        { name: 'Snowman Squad', roleId: '1361466801443180584' },
        { name: 'Gorilla Squad', roleId: '1361466637261471961' },
        { name: 'Bee Squad', roleId: '1361466746149666956' },
        { name: 'Alligator Squad', roleId: '1361466697059664043' },
    ];
    const SL_SQUAD_NAME = 2;
    const SL_EVENT_SQUAD = 3;
    const AD_ID = 1;
    const AD_PREFERENCE = 7;

    try {
        await interaction.deferReply({ ephemeral: true });

        let inviteData;
        try {
            inviteData = await fetchInviteById(interaction.message.id);
            if (!inviteData) throw new Error('404');
        } catch (apiError) {
            if (apiError.message === '404') {
                await interaction.editReply(
                    noticePayload(
                        'This invite seems to have expired or is invalid.',
                        { title: 'Invite Expired', subtitle: 'Squad Invite'}
                    )
                );
            } else {
                console.error('Error fetching invite data:', apiError.message);
                await interaction.editReply(
                    noticePayload(
                        'Could not verify the invite status.',
                        { title: 'Invite Error', subtitle: 'Squad Invite'}
                    )
                );
            }
            return;
        }
        if (!inviteData) {
            await interaction.editReply(
                noticePayload(
                    'The invite is no longer available.',
                    { title: 'Invite Unavailable', subtitle: 'Squad Invite'}
                )
            );
            return;
        }

        const { squad_name: squadName, tracking_message_id: trackingMessageId, command_user_id: commandUserID, invited_member_id: invitedMemberId, squad_type: squadType, invite_status: currentInviteStatus } = inviteData;

        if (currentInviteStatus === 'Accepted' || currentInviteStatus === 'Rejected' || currentInviteStatus === 'Squad Full') {
            await interaction.editReply(
                noticePayload(
                    `This invite has already been processed (${currentInviteStatus}).`,
                    { title: 'Invite Processed', subtitle: 'Squad Invite'}
                )
            );
            return;
        }
        if (interaction.user.id !== invitedMemberId) {
            await interaction.editReply(
                noticePayload(
                    'You cannot interact with an invite meant for someone else.',
                    { title: 'Invite Restricted', subtitle: 'Squad Invite'}
                )
            );
            return;
        }

        const gymClassGuild = await interaction.client.guilds.fetch('752216589792706621').catch(() => null);
        const ballheadGuild = await interaction.client.guilds.fetch('1233740086839869501').catch(() => null);
        const guild = interaction.guild && (interaction.guild.id === '752216589792706621' || interaction.guild.id === '1233740086839869501') ? interaction.guild : (gymClassGuild || ballheadGuild);
        if (!guild) {
            console.error('Could not fetch required Guilds.');
            await interaction.editReply(
                noticePayload(
                    'Could not find the necessary server.',
                    { title: 'Server Not Found', subtitle: 'Squad Invite'}
                )
            );
            return;
        }
        let trackingChannel;
        if (ballheadGuild) { trackingChannel = ballheadGuild.channels.cache.get('1233853415952748645') || await ballheadGuild.channels.fetch('1233853415952748645').catch(err => { console.error(`Failed to fetch tracking channel: ${err.message}`); return null; }); }
        let trackingMessage;
        if (trackingChannel && trackingMessageId) { trackingMessage = await trackingChannel.messages.fetch(trackingMessageId).catch(err => { console.warn(`Failed to fetch tracking message ${trackingMessageId}: ${err.message}`); return null; }); }
        const commandUser = await interaction.client.users.fetch(commandUserID).catch(err => { console.error(`Failed to fetch command user ${commandUserID}: ${err.message}`); return null; });
        if (!commandUser) {
            await interaction.editReply(
                noticePayload(
                    'Could not find the user who sent the invite.',
                    { title: 'Invite Error', subtitle: 'Squad Invite'}
                )
            );
            return;
        }
        const inviteMessageChannel = interaction.channel || await interaction.client.channels.fetch(interaction.channelId).catch(err => { console.error(`Failed to fetch invite message channel ${interaction.channelId}: ${err.message}`); return null; });
        if (!inviteMessageChannel) {
            await interaction.editReply(
                noticePayload(
                    'Failed to find the channel where the invite was sent.',
                    { title: 'Channel Missing', subtitle: 'Squad Invite'}
                )
            );
            return;
        }
        const inviteMessage = await inviteMessageChannel.messages.fetch(interaction.message.id).catch(err => { console.error(`Failed to fetch invite message ${interaction.message.id}: ${err.message}`); return null; });
        if (!inviteMessage) {
            await interaction.editReply(
                noticePayload(
                    'Failed to find the original invite message.',
                    { title: 'Invite Missing', subtitle: 'Squad Invite'}
                )
            );
            return;
        }


        if (action === 'accept') {
            const member = await guild.members.fetch(invitedMemberId).catch(() => null);
            if (!member) {
                await interaction.editReply(
                    noticePayload(
                        'You could not be found in the server.',
                        { title: 'Member Not Found', subtitle: 'Squad Invite'}
                    )
                );
                return;
            }

            const sheets = await getSheetsClient();

            const [squadMembersResponse, allDataResponse, squadLeadersResponse] = await Promise.all([
                sheets.spreadsheets.values.get({ spreadsheetId: '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k', range: 'Squad Members!A:E' }),
                sheets.spreadsheets.values.get({ spreadsheetId: '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k', range: 'All Data!A:H' }),
                sheets.spreadsheets.values.get({ spreadsheetId: '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k', range: 'Squad Leaders!A:F' })
            ]).catch(() => { throw new Error('Failed to retrieve sheet data for processing invite.'); });

            const squadMembersData = (squadMembersResponse.data.values || []).slice(1);
            const allData = (allDataResponse.data.values || []);
            const allDataHeaderless = allData.slice(1);
            const squadLeadersData = (squadLeadersResponse.data.values || []).slice(1);

            const membersInSquad = squadMembersData.filter(row => row && row.length > 2 && row[2]?.trim() === squadName);
            const currentMemberCount = membersInSquad.length + 1;
            const max_members_local = 10;
            if (currentMemberCount >= max_members_local) {
                await interaction.editReply({
                    ...noticePayload(
                        `Cannot accept: Squad **${squadName}** is full (${currentMemberCount}/${max_members_local}).`,
                        { title: 'Squad Full', subtitle: 'Squad Invite'}
                    ),
                    ephemeral: true
                });
                if (trackingMessage) {
                    const trackingContainer = buildNoticeContainer({
                        title: 'Invite Failed',
                        subtitle: squadName,
                        lines: [`Invite from <@${commandUserID}> to <@${invitedMemberId}> failed: Squad Full.`]
                    });
                    await trackingMessage.edit({ flags: MessageFlags.IsComponentsV2, components: [trackingContainer] }).catch(console.error);
                }
                try { await updateInviteStatus(interaction.message.id, 'Squad Full'); } catch (apiError) { console.error('API Error updating invite status to \'Squad Full\':', apiError.message); }
                const components = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`invite_accept_${interaction.message.id}`).setLabel('Accept Invite').setStyle(ButtonStyle.Success).setDisabled(true),
                    new ButtonBuilder().setCustomId(`invite_reject_${interaction.message.id}`).setLabel('Reject Invite').setStyle(ButtonStyle.Danger).setDisabled(true)
                );
                const squadFullContainer = new ContainerBuilder();
                const block = buildTextBlock({ title: 'Squad Full',
                    subtitle: squadName, lines: [
                    `Squad **${squadName}** is full (${currentMemberCount}/${max_members_local }).`
                ] });
            if (block) squadFullContainer.addTextDisplayComponents(block);
                await inviteMessage.edit({ flags: MessageFlags.IsComponentsV2, components: [squadFullContainer, components] }).catch(console.error);
                return;
            }

            await interaction.editReply(
                noticePayload(
                    `You have accepted the invite to join **${squadName}** (${squadType})!`,
                    { title: 'Invite Accepted', subtitle: 'Squad Invite'}
                )
            );
            if (trackingMessage) {
                const trackingContainer = buildNoticeContainer({
                    title: 'Invite Accepted',
                    subtitle: squadName,
                    lines: [`<@${member.id}> accepted invite from <@${commandUserID}> to join **${squadName}** (${squadType}).`]
                });
                await trackingMessage.edit({ flags: MessageFlags.IsComponentsV2, components: [trackingContainer] }).catch(console.error);
            }
            try { await updateInviteStatus(interaction.message.id, 'Accepted'); } catch (apiError) { console.error('API Error updating invite status to \'Accepted\':', apiError.message); }

            let userInAllDataIndex = allDataHeaderless.findIndex(row => row && row.length > AD_ID && row[AD_ID] === invitedMemberId);
            const defaultEventSquad = 'N/A'; const defaultOpenSquad = 'FALSE'; const defaultIsLeader = 'No'; let existingPreference = 'TRUE';
            let eventSquadNameToAssign = null; const leaderRow = squadLeadersData.find(row => row && row.length > SL_SQUAD_NAME && row[SL_SQUAD_NAME] === squadName);
            if (leaderRow) { const leaderEventSquad = leaderRow[SL_EVENT_SQUAD]; if (leaderEventSquad && leaderEventSquad !== 'N/A') { eventSquadNameToAssign = leaderEventSquad; } }

            if (userInAllDataIndex !== -1) {
                const sheetRowIndex = userInAllDataIndex + 2;
                const existingRow = allDataHeaderless[userInAllDataIndex];
                if (existingRow.length > AD_PREFERENCE && (existingRow[AD_PREFERENCE] === 'TRUE' || existingRow[AD_PREFERENCE] === 'FALSE')) { existingPreference = existingRow[AD_PREFERENCE]; }
                const updatedRowData = [member.user.username, member.id, squadName, squadType, eventSquadNameToAssign || defaultEventSquad, defaultOpenSquad, defaultIsLeader, existingPreference];
                while (updatedRowData.length < 8) { updatedRowData.push(''); }
                await sheets.spreadsheets.values.update({ spreadsheetId: '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k', range: `All Data!A${sheetRowIndex}:H${sheetRowIndex}`, valueInputOption: 'RAW', resource: { values: [updatedRowData] } }).catch(err => { throw new Error(`Failed to update All Data sheet: ${err.message}`); });
            } else {
                const newRowData = [member.user.username, member.id, squadName, squadType, eventSquadNameToAssign || defaultEventSquad, defaultOpenSquad, defaultIsLeader, existingPreference];
                while (newRowData.length < 8) { newRowData.push(''); }
                await sheets.spreadsheets.values.append({ spreadsheetId: '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k', range: 'All Data!A1', valueInputOption: 'RAW', resource: { values: [newRowData] } }).catch(err => { throw new Error(`Failed to append to All Data sheet: ${err.message}`); });
            }
            let currentDate = new Date(); let dateString = `${(currentDate.getMonth() + 1).toString().padStart(2, '0')}/${currentDate.getDate().toString().padStart(2, '0')}/${currentDate.getFullYear().toString().slice(-2)}`;
            const newSquadMemberRow = [member.user.username, member.id, squadName, eventSquadNameToAssign || defaultEventSquad, dateString];
            while (newSquadMemberRow.length < 5) { newSquadMemberRow.push(''); }
            await sheets.spreadsheets.values.append({ spreadsheetId: '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k', range: 'Squad Members!A1', valueInputOption: 'RAW', resource: { values: [newSquadMemberRow] } }).catch(err => { throw new Error(`Failed to append to Squad Members sheet: ${err.message}`); });


            try { await member.setNickname(`[${squadName}] ${member.user.username}`); } catch (error) {
                if (error.code === 50013) { console.log(`Missing permissions to set nickname for ${member.user.tag}.`); } else { console.error(`Could not change nickname for ${member.user.tag}:`, error.message); }
            }

        let assignedMascotRoleName = null;
        if (eventSquadNameToAssign) {
            const mascotInfo = mascotSquads_local.find(m => m.name === eventSquadNameToAssign);
            if (mascotInfo) {
                try {
                    const roleToAdd = await guild.roles.fetch(mascotInfo.roleId);
                    if (roleToAdd) {
                        await member.roles.add(roleToAdd);
                        assignedMascotRoleName = roleToAdd.name;
                        console.log(`Added mascot role '${assignedMascotRoleName}' to ${member.user.tag}`);
                    } else {
                        console.warn(`Mascot role ID ${mascotInfo.roleId} (${mascotInfo.name}) not found.`);
                        await interaction.followUp({
                            ...noticePayload(
                                `Warning: Joined squad, but couldn't find mascot role (${mascotInfo.name}).`,
                                { title: 'Mascot Role Missing', subtitle: 'Squad Invite'}
                            ),
                            ephemeral: true
                        }).catch(() => {});
                    }
                } catch (roleError) {
                    console.error(`Failed to add mascot role ${mascotInfo.name}: ${roleError.message}`);
                    await interaction.followUp({
                        ...noticePayload(
                            `Warning: Joined squad, but couldn't assign mascot role (${mascotInfo.name}).`,
                            { title: 'Mascot Role Failed', subtitle: 'Squad Invite'}
                        ),
                        ephemeral: true
                    }).catch(() => {});
                }
            } else {
                console.warn(`No role mapping for event squad: ${eventSquadNameToAssign}`);
            }
        }

            const acceptanceContainer = new ContainerBuilder()
                .setAccentColor(0x2ECC71)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`## Welcome to ${squadName}!`),
                    new TextDisplayBuilder().setContent(`You've joined the squad. Good luck!`)
                );
            await inviteMessage.edit({ flags: MessageFlags.IsComponentsV2, components: [acceptanceContainer] }).catch(console.error);

            const dmContainer = new ContainerBuilder()
                .setAccentColor(0x2ECC71)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`## ${member.user.username} Joined!`),
                    new TextDisplayBuilder().setContent(`They accepted your invite to **${squadName}**.`)
                );
            if (assignedMascotRoleName) {
                dmContainer.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`-# Assigned role: ${assignedMascotRoleName}`)
                );
            }
            await commandUser.send({ flags: MessageFlags.IsComponentsV2, components: [dmContainer] }).catch(err => { console.log(`Failed to DM command user ${commandUserID}: ${err.message}`); });

            try { await deleteInvite(interaction.message.id); } catch (apiError) { console.error('API Error deleting invite:', apiError.message); }

        } else if (action === 'reject') {
            await interaction.editReply({
                ...noticePayload(
                    'You have rejected the invite.',
                    { title: 'Invite Rejected', subtitle: 'Squad Invite'}
                ),
                ephemeral: true
            });
            if (trackingMessage) {
                const trackingContainer = buildNoticeContainer({
                    title: 'Invite Rejected',
                    subtitle: squadName,
                    lines: [`<@${invitedMemberId}> rejected invite from <@${commandUserID}> for **${squadName}**.`]
                });
                await trackingMessage.edit({ flags: MessageFlags.IsComponentsV2, components: [trackingContainer] }).catch(console.error);
            }
            try { await updateInviteStatus(interaction.message.id, 'Rejected'); } catch (apiError) { console.error('API Error updating status to \'Rejected\':', apiError.message); }
            const rejectionContainer = new ContainerBuilder()
                .setAccentColor(0x95A5A6)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`## Invite Declined`),
                    new TextDisplayBuilder().setContent(`You declined the invite to **${squadName}**.`)
                );
            await inviteMessage.edit({ flags: MessageFlags.IsComponentsV2, components: [rejectionContainer] }).catch(console.error);
            const dmRejectionContainer = new ContainerBuilder()
                .setAccentColor(0x95A5A6)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`## Invite Declined`),
                    new TextDisplayBuilder().setContent(`**${interaction.user.username}** declined your invite to **${squadName}**.`)
                );
            await commandUser.send({ flags: MessageFlags.IsComponentsV2, components: [dmRejectionContainer] }).catch(err => { console.log(`Failed to DM command user about rejection: ${err.message}`); });
            try { await deleteInvite(interaction.message.id); } catch (apiError) { console.error('API Error deleting rejected invite:', apiError.message); }
        } else {
            await interaction.editReply({
                ...noticePayload(
                    'Unknown action specified.',
                    { title: 'Unknown Action', subtitle: 'Squad Invite'}
                ),
                ephemeral: true
            });
        }

    } catch (error) {
        console.error('Error handling invite button interaction:', error);
        await interaction.editReply({
            ...noticePayload(
                'An error occurred while processing the invite interaction.',
                { title: 'Invite Error', subtitle: 'Squad Invite'}
            ),
            ephemeral: true
        }).catch(console.error);
        try {
            const client = interaction.client; if (!client) return;
            const errorGuild = await client.guilds.fetch('1233740086839869501').catch(() => null); if (!errorGuild) return;
            const errorChannel = await errorGuild.channels.fetch('1233853458092658749').catch(() => null); if (!errorChannel) return;
            const errorContainer = new ContainerBuilder();
            const block = buildTextBlock({ title: 'Invite Interaction Error',
                subtitle: 'Squad invite action failed', lines: [
                `**User:** ${interaction.user.tag} (${interaction.user.id })`,
                `**Action:** ${action}`,
                `**Message ID:** ${interaction.message.id}`,
                `**Error:** ${error.message}`
            ] });
            if (block) errorContainer.addTextDisplayComponents(block);
            await errorChannel.send({ flags: MessageFlags.IsComponentsV2, components: [errorContainer] });
        } catch (logError) { console.error('Failed to log button interaction error:', logError); }
    }
};

const handlePagination1 = async (interaction, customId) => {
    try {
        await interaction.deferUpdate();
        console.log(`[Pagination] Received ${customId} on interaction ${interaction.id}`);

        const resolvedCustomId = customId ?? interaction.customId;
        const originalInteractionId = interaction.message.interaction?.id;
        console.log(`[Pagination] originalInteractionId=${originalInteractionId}`);

        if (!originalInteractionId) {
            console.error('Could not retrieve original interaction ID from message.');
            return;
        }

        const commandState = interaction.client.squadsPagination.get(originalInteractionId);
        console.log(`[Pagination] commandState for ${originalInteractionId}:`, commandState);

        if (!commandState) {
            console.error(`No commandData found for original interaction ID: ${originalInteractionId}`);
            await interaction.editReply(
                noticePayload(
                    'Sorry, I can\'t find the data for this list anymore. Please run the command again.',
                    { title: 'Pagination Expired', subtitle: 'Squad List'}
                )
            );
            return;
        }

        const { squadList, totalPages, currentPage } = commandState;
        let newPage = currentPage;

        if (resolvedCustomId === 'squads_next') {
            newPage = currentPage + 1;
        } else if (resolvedCustomId === 'squads_prev') {
            newPage = currentPage - 1;
        } else {
            console.warn(`Received unexpected customId in handlePagination1: ${resolvedCustomId}`);
            return;
        }

        if (newPage < 1 || newPage > totalPages) {
            console.warn(`Pagination attempt outside bounds: newPage=${newPage}, totalPages=${totalPages}`);
            return;
        }

        interaction.client.squadsPagination.get(originalInteractionId).currentPage = newPage;

        const generateContainer = (page) => {
            const start = (page - 1) * ITEMS_PER_PAGE;
            const end = start + ITEMS_PER_PAGE;
            const pageItems = squadList.slice(start, Math.min(end, squadList.length));
            const container = new ContainerBuilder();
            const block = buildTextBlock({ title: 'Squad Registry',
                subtitle: 'All registered squads', lines: [
                pageItems.length > 0 ? pageItems.join('\n') : 'No squads on this page.'
            ] });
            if (block) container.addTextDisplayComponents(block);
            return container;
        };

        const generateButtons = (page) => {
            return new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('squads_prev')
                        .setLabel('Previous')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(page === 1),
                    new ButtonBuilder()
                        .setCustomId('squads_next')
                        .setLabel('Next')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(page === totalPages)
                );
        };

        await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [generateContainer(newPage), generateButtons(newPage)] });

    } catch (error) {
        console.error('Error handling pagination:', error);

        try {
            if (!interaction.client) throw new Error('Interaction client is not available.');

            const errorGuild = await interaction.client.guilds.fetch(BALLHEAD_GUILD_ID).catch(() => null);
            if (!errorGuild) throw new Error(`Could not fetch error guild: ${BALLHEAD_GUILD_ID}`);

            const errorChannel = await errorGuild.channels.fetch(BOT_BUGS_CHANNEL_ID).catch(() => null);
            if (!errorChannel) throw new Error(`Could not fetch error channel: ${BOT_BUGS_CHANNEL_ID}`);

            const paginationErrorContainer = new ContainerBuilder();
            const block = buildTextBlock({ title: 'Pagination Error',
                subtitle: 'Squad registry navigation failed', lines: [
                `**Error:** ${error.message}`,
                `**Interaction Custom ID:** ${interaction.customId}`,
                `**Original Command ID:** ${interaction.message.interaction?.id}`
            ] });
            if (block) paginationErrorContainer.addTextDisplayComponents(block);
            await errorChannel.send({ flags: MessageFlags.IsComponentsV2, components: [paginationErrorContainer] });
        } catch (logError) {
            console.error('Failed to log pagination error:', logError);
        }

        try {
            await interaction.followUp({
                ...noticePayload(
                    'An error occurred while changing pages. Please try running the command again.',
                    { title: 'Pagination Error', subtitle: 'Squad List'}
                ),
                ephemeral: true
            });
        } catch (followUpError) {
            console.error('Failed to send follow-up error message:', followUpError);
        }
    }
};

const handleOfficialsApplicationApprove = async (interaction) => {
    try {
        await interaction.deferReply({ ephemeral: true });
        const userId = interaction.customId.split('_')[1];
        const user = await interaction.guild.members.fetch(userId);
        const roleId = '1286098091396698134';

        const qaButton = new ButtonBuilder()
            .setCustomId('officialsQna')
            .setLabel('Help!')
            .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(qaButton);

        try {
            const dmContainer = new ContainerBuilder();
            const block = buildTextBlock({ title: 'Officials Application Approved',
                subtitle: 'Official Prospect role granted', lines: [
                'Your officials application has been approved.',
                'If you are unsure what to do next, press the "Help" button below.'
            ] });
            if (block) dmContainer.addTextDisplayComponents(block);
            await user.send({
                flags: MessageFlags.IsComponentsV2,
                components: [dmContainer, row] });
        } catch (dmError) {
            console.error('Failed to send DM to user:', dmError.message);
        }


        const sheets = await getSheetsClient();
        const applicationUrl = interaction.message.url;
        console.log(`Application URL : ${applicationUrl}`);
        await updateOfficialApplicationStatus(sheets, applicationUrl, 'Approved');

        const pgClient = new Client(clientConfig);
        await pgClient.connect();
        await pgClient.query(
            'DELETE FROM official_applications WHERE discord_id = $1',
            [userId]
        );
        await pgClient.end();

        const approvedContainer = new ContainerBuilder();
        const block = buildTextBlock({ title: 'Application Approved',
            subtitle: 'Officials Program', lines: ['This application has been approved.'] });
            if (block) approvedContainer.addTextDisplayComponents(block);

        await interaction.message.edit({
            flags: MessageFlags.IsComponentsV2,
            components: [approvedContainer] });

        await interaction.editReply({
            ...noticePayload(
                'The application has been successfully approved!',
                { title: 'Application Approved', subtitle: 'Officials Program'}
            ),
            ephemeral: true });

        const officialRole = interaction.guild.roles.cache.get(roleId);
        await user.roles.add(officialRole);

    } catch (error) {
        console.error('Error approving application:', error);

        if (!interaction.replied) {
            await interaction.editReply({
                ...noticePayload(
                    'There was an error while approving the application. Please try again later.',
                    { title: 'Approval Failed', subtitle: 'Officials Program'}
                ),
                ephemeral: true });
        }
    }
};

const updateOfficialApplicationStatus = async (sheets, applicationUrl, newStatus) => {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: '116zau8gWkOizH9KCboH8Xg5SjKOHR_Lc_asfaYQfMdI',
            range: 'Application!A:F' });

        const rows = response.data.values;
        if (!rows || rows.length === 0) {
            throw new Error('No data found in the sheet.');
        }

        const rowIndex = rows.findIndex(row => row[3] === applicationUrl);

        if (rowIndex === -1) {
            throw new Error('Application URL not found in the sheet.');
        }

        const updateRange = `Application!F${rowIndex + 1}`;
        await sheets.spreadsheets.values.update({
            spreadsheetId: '116zau8gWkOizH9KCboH8Xg5SjKOHR_Lc_asfaYQfMdI',
            range: updateRange,
            valueInputOption: 'RAW',
            resource: {
                values: [[newStatus]] } });

        console.log(`Official application status updated to "${newStatus}" in Google Sheets.`);
    } catch (error) {
        console.error('Error updating official application status:', error);
        throw new Error(`Failed to update official application status: ${error.message}`);
    }
};

const handleQnAInteraction = async (interaction) => {
    const qaContainer = new ContainerBuilder();
    const block = buildTextBlock({ title: 'Officials Program Q&A',
        subtitle: 'Common questions and answers', lines: [`**Q: What videos do I have to submit?**
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

If you're still confused, feel free to read-up on the [documentation](https://docs.google.com/document/d/1to-7k3EoB-bnBbzKS5zRggWLDKB8ApyLIib_a_te8TI/edit?usp=sharing).`] });
            if (block) qaContainer.addTextDisplayComponents(block);

    await interaction.reply({
        flags: MessageFlags.IsComponentsV2,
        components: [qaContainer],
        ephemeral: true });
};

const handleOfficialsApplicationReject = async (interaction) => {
    try {
        await interaction.deferReply({ ephemeral: true });

        const userId = interaction.customId.split('_')[1];
        const user = await interaction.guild.members.fetch(userId);

        const nextStepsButton = new ButtonBuilder()
            .setCustomId('officialsQnaReject')
            .setLabel('Help!')
            .setStyle(ButtonStyle.Primary);

        const actionRow = new ActionRowBuilder().addComponents(nextStepsButton);

        try {
            const dmContainer = new ContainerBuilder();
            const block = buildTextBlock({ title: 'Officials Application Rejected',
                subtitle: 'Next steps available', lines: [
                'Unfortunately, your application for officials has been rejected.',
                'If you are confused about why, use the "Help!" button below.'
            ] });
            if (block) dmContainer.addTextDisplayComponents(block);
            await user.send({
                flags: MessageFlags.IsComponentsV2,
                components: [dmContainer, actionRow] });
        } catch (dmError) {
            console.error('Failed to send DM to user:', dmError.message);
        }

        const sheets = await getSheetsClient();
        const applicationUrl = interaction.message.url;
        await updateOfficialApplicationStatus(sheets, applicationUrl, 'Rejected');

        const pgClient = new Client(clientConfig);
        await pgClient.connect();
        await pgClient.query(
            'DELETE FROM official_applications WHERE discord_id = $1',
            [userId]
        );
        await pgClient.end();

        const rejectedContainer = new ContainerBuilder();
        const block = buildTextBlock({ title: 'Application Rejected',
            subtitle: 'Officials Program', lines: ['This application has been rejected.'] });
            if (block) rejectedContainer.addTextDisplayComponents(block);

        await interaction.message.edit({
            flags: MessageFlags.IsComponentsV2,
            components: [rejectedContainer] });

        await interaction.editReply({
            ...noticePayload(
                'The application has been successfully rejected!',
                { title: 'Application Rejected', subtitle: 'Officials Program'}
            ),
            ephemeral: true });

    } catch (error) {
        console.error('Error rejecting application:', error);

        if (!interaction.replied) {
            await interaction.editReply({
                ...noticePayload(
                    'There was an error while rejecting the application. Please try again later.',
                    { title: 'Rejection Failed', subtitle: 'Officials Program'}
                ),
                ephemeral: true });
        }
    }
};

const handleNextStepsInteraction = async (interaction) => {
    const nextStepsContainer = new ContainerBuilder();
    const block = buildTextBlock({ title: 'Why Your Application Was Rejected',
        subtitle: 'What to do next', lines: [
        `**Why was my application rejected?**
- **Not Meeting Requirements**: You may not have met the basic eligibility, such as being Level 5 in the Gym Class Discord or having no recent moderation logs.
- **Incomplete Application**: Missing or incomplete information in your application or not agreeing to terms and rules can result in rejection.`,
        `**What should I do next?**
1. **Meet Basic Requirements**: Ensure you meet all the basic requirements, such as no moderation logs and reaching the required level in the Discord.
2. **Complete Your Application**: When reapplying, double-check that your application is complete and all required fields are filled out.
3. **Wait If Needed**: If rejected due to moderation logs, allow at least 1 month before reapplying.`
    ] });
            if (block) nextStepsContainer.addTextDisplayComponents(block);

    await interaction.reply({
        flags: MessageFlags.IsComponentsV2,
        components: [nextStepsContainer],
        ephemeral: true });
};

const handleApplyBaseLeagueModal = async (interaction) => {
    await interaction.deferReply({ ephemeral: true });

    const leagueName = interaction.fields.getTextInputValue('league-name');
    const discordInvite = interaction.fields.getTextInputValue('discord-invite');

    const level5RoleId = '924522770057031740';
    const higherRoles = [
        '924522921370714152',
        '924522979768016946',
        '924523044268032080',
        '1242262635223715971',
        '925177626644058153',
        '1087071951270453278',
        '1223408044784746656',
    ];

    const userRoles = interaction.member.roles.cache;
    const hasRequiredRole = userRoles.has(level5RoleId) || higherRoles.some(roleId => userRoles.has(roleId));

    if (!hasRequiredRole) {
        return interaction.editReply(
            noticePayload(
                'You need to be at least Level 5 to apply for a Base League. Try chatting with the community more to gain more level, best of luck!',
                { title: 'Eligibility Required', subtitle: 'Base League'}
            )
        );
    }

    const pgClient = new Client(clientConfig);
    await pgClient.connect();

    try {
        const inviteCodeMatch = discordInvite.match(/discord(?:app)?\.com\/invite\/([^/\s]+)/i) || discordInvite.match(/discord\.gg\/([^/\s]+)/i);
        if (!inviteCodeMatch) {
            return interaction.editReply(
                noticePayload(
                    'Invalid invite link format. Please provide a valid Discord invite link.',
                    { title: 'Invalid Invite', subtitle: 'Base League'}
                )
            );
        }
        const inviteCode = inviteCodeMatch[1];

        const inviteResponse = await axios.get(`https://discord.com/api/v10/invites/${inviteCode}`, {
            params: {
                with_counts: true,
                with_expiration: true,
                with_metadata: true },
            headers: {
                Authorization: `Bot ${DISCORD_BOT_TOKEN}` } });

        const inviteData = inviteResponse.data;

        if (inviteData.expires_at) {
            return interaction.editReply(
                noticePayload(
                    'Please provide an invite link that does not expire (set to "Never").',
                    { title: 'Invite Expired', subtitle: 'Base League'}
                )
            );
        }

        const guild = inviteData.guild;

        if (!guild) {
            return interaction.editReply(
                noticePayload(
                    'Invalid invite link or the guild is no longer available.',
                    { title: 'Invite Invalid', subtitle: 'Base League'}
                )
            );
        }

        const serverName = guild.name || 'Unknown Server Name';
        const serverId = guild.id || 'Unknown Server ID';
        const memberCount = inviteData.approximate_member_count || 0;

        console.log(`Fetched member count from invite: ${memberCount}`);

        const serverIcon = guild.icon
            ? `https://cdn.discordapp.com/icons/${serverId}/${guild.icon}.png`
            : 'Not Available';
        const serverBanner = guild.banner
            ? `https://cdn.discordapp.com/banners/${serverId}/${guild.banner}.png`
            : 'Not Available';
        const vanityUrl = guild.vanity_url_code
            ? `https://discord.gg/${guild.vanity_url_code}`
            : 'Not Available';
        const serverDescription = guild.description || 'No description available';
        const serverFeatures = guild.features.length > 0
            ? guild.features.join(', ')
            : 'None';

        const user = interaction.user;
        const ownerProfilePicture = user.avatar
            ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
            : 'https://cdn.discordapp.com/embed/avatars/0.png';

        const existingServer = await pgClient.query(
            'SELECT * FROM "Active Leagues" WHERE server_id = $1',
            [serverId]
        );

        if (existingServer.rows.length > 0) {
            return interaction.editReply(
                noticePayload(
                    'This server is already registered as a Base League.',
                    { title: 'Already Registered', subtitle: 'Base League'}
                )
            );
        }

        const existingLeague = await pgClient.query(
            'SELECT * FROM "Active Leagues" WHERE owner_id = $1 AND league_type = \'Base\'',
            [user.id]
        );

        if (existingLeague.rows.length > 0) {
            return interaction.editReply(
                noticePayload(
                    'You already own a Base League.',
                    { title: 'Application Blocked', subtitle: 'Base League'}
                )
            );
        }

        await pgClient.query(
            `INSERT INTO "Active Leagues"
             (owner_id, owner_discord_name, league_name, server_name, server_id, member_count, server_owner_id, league_type, league_status, approval_date, is_sponsored, league_invite, server_icon, server_banner, vanity_url, server_description, server_features, owner_profile_picture)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'Base', 'Active', NOW(), false, $8, $9, $10, $11, $12, $13, $14)`,
            [
                user.id,
                user.username,
                leagueName,
                serverName,
                serverId,
                memberCount,
                user.id,
                discordInvite,
                serverIcon,
                serverBanner,
                vanityUrl,
                serverDescription,
                serverFeatures,
                ownerProfilePicture
            ]
        );

        const baseLeagueRoleId = '1298049143134224384';
        const leagueOwnerRole = '1220577913603231805';
        const baseRole = interaction.guild.roles.cache.get(baseLeagueRoleId);
        const mainRole = interaction.guild.roles.cache.get(leagueOwnerRole);
        if (baseRole) {
            await interaction.member.roles.add(baseRole);
            await interaction.member.roles.add(mainRole);
        } else {
            console.error(`Role with ID ${baseLeagueRoleId} not found.`);
        }

        await interaction.editReply(
            noticePayload(
                'Your Base League has been registered successfully!',
                { title: 'Base League Registered', subtitle: leagueName}
            )
        );

        const logChannelId = '1298997780303315016';
        const logChannel = await interaction.client.channels.fetch(logChannelId);

        if (logChannel) {
            const leagueContainer = new ContainerBuilder();
            const block = buildTextBlock({ title: 'New Base League Registered',
                subtitle: leagueName, lines: [
                `**Owner:** <@${user.id}>`,
                `**Server Name:** ${serverName}`,
                `**Invite Link:** ${discordInvite}`,
                `**Member Count:** ${memberCount.toString()}`
            ] });
            if (block) leagueContainer.addTextDisplayComponents(block);

            await logChannel.send({ flags: MessageFlags.IsComponentsV2, components: [leagueContainer] });
        } else {
            console.error('Log channel not found.');
        }

    } catch (error) {
        console.error('Error in handleApplyBaseLeagueModal:', error);

        const errorPayload = noticePayload(
            'An error occurred while processing your application.',
            { title: 'Application Failed', subtitle: 'Base League'}
        );
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                ...errorPayload,
                ephemeral: true });
        } else {
            await interaction.editReply(errorPayload);
        }
    } finally {
        await pgClient.end();
    }
};

const handleApproveLeague = async (interaction) => {
    const messageId = interaction.message.id;
    const pgClient = new Client(clientConfig);
    await pgClient.connect();

    try {
        const res = await pgClient.query('SELECT * FROM "League Applications" WHERE application_message_id = $1', [messageId]);
        if (res.rows.length === 0) {
            return interaction.reply({
                ...noticePayload(
                    'League application not found.',
                    { title: 'Not Found', subtitle: 'League Applications'}
                ),
                ephemeral: true
            });
        }

        const application = res.rows[0];
        const member = await interaction.guild.members.fetch(application.applicant_id);

        await pgClient.query(
            'UPDATE "League Applications" SET review_status = $1, is_approved = $2, reviewed_date = NOW(), reviewed_by = $3 WHERE application_message_id = $4',
            ['Approved', true, interaction.user.id, messageId]
        );

        let serverData = {
            serverName: 'Unknown Server Name',
            serverId: 'Unknown Server ID',
            memberCount: null,
            serverIcon: 'Not Available',
            serverBanner: 'Not Available',
            vanityUrl: 'Not Available',
            serverDescription: 'No description available',
            serverFeatures: 'None' };

        try {
            const invite = await interaction.client.fetchInvite(application.league_invite);
            const guild = invite.guild;
            if (guild) {
                serverData = {
                    serverName: guild.name || serverData.serverName,
                    serverId: guild.id || serverData.serverId,
                    memberCount: guild.memberCount || guild.approximateMemberCount || serverData.memberCount,
                    serverIcon: guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png` : serverData.serverIcon,
                    serverBanner: guild.banner ? `https://cdn.discordapp.com/banners/${guild.id}/${guild.banner}.png` : serverData.serverBanner,
                    vanityUrl: guild.vanityURLCode ? `https://discord.gg/${guild.vanityURLCode}` : serverData.vanityUrl,
                    serverDescription: guild.description || serverData.serverDescription,
                    serverFeatures: guild.features.length > 0 ? guild.features.join(', ') : serverData.serverFeatures };
                if (isNaN(serverData.memberCount)) {
                    serverData.memberCount = null;
                }
            }
        } catch (error) {
            console.error('Error fetching guild from invite:', error);
        }

        const ownerProfilePicture = member.user.avatar
            ? `https://cdn.discordapp.com/avatars/${member.user.id}/${member.user.avatar}.png`
            : 'https://cdn.discordapp.com/embed/avatars/0.png';


        const leagueRes = await pgClient.query('SELECT * FROM "Active Leagues" WHERE owner_id = $1 AND league_name = $2', [application.applicant_id, application.league_name]);

        if (leagueRes.rows.length > 0) {
            await pgClient.query(
                `UPDATE "Active Leagues" SET
                                             league_type = $1,
                                             approval_date = NOW(),
                                             server_id = $2,
                                             server_name = $3,
                                             member_count = $4,
                                             server_icon = $5,
                                             server_banner = $6,
                                             vanity_url = $7,
                                             server_description = $8,
                                             server_features = $9,
                                             owner_profile_picture = $10
                 WHERE owner_id = $11 AND league_name = $12`,
                [
                    application.applied_league_level,
                    serverData.serverId,
                    serverData.serverName,
                    serverData.memberCount,
                    serverData.serverIcon,
                    serverData.serverBanner,
                    serverData.vanityUrl,
                    serverData.serverDescription,
                    serverData.serverFeatures,
                    ownerProfilePicture,
                    application.applicant_id,
                    application.league_name
                ]
            );
            console.log('Updated existing league with new data.');
        } else {
            await pgClient.query(
                `INSERT INTO "Active Leagues"
                 (owner_id, owner_discord_name, league_name, league_type, league_status, approval_date, is_sponsored, league_invite, server_id, server_name, member_count, server_icon, server_banner, vanity_url, server_description, server_features, owner_profile_picture)
                 VALUES ($1, $2, $3, $4, 'Active', NOW(), $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
                [

                    application.applicant_discord_name,
                    application.league_name,
                    application.applied_league_level,
                    application.applied_league_level === 'Sponsored',
                    application.league_invite,
                    serverData.serverId,
                    serverData.serverName,
                    serverData.memberCount,
                    serverData.serverIcon,
                    serverData.serverBanner,
                    serverData.vanityUrl,
                    serverData.serverDescription,
                    serverData.serverFeatures,
                    ownerProfilePicture
                ]
            );
            console.log('Inserted new league with data.');
        }

        let oldRoleId, newRoleId;
        if (application.applied_league_level === 'Active') {
            oldRoleId = '1298049143134224384';
            newRoleId = '1298049189019783199';
        } else if (application.applied_league_level === 'Sponsored') {
            oldRoleId = '1298049189019783199';
            newRoleId = '1298049247073276014';
        }

        await member.roles.remove(oldRoleId);
        await member.roles.add(newRoleId);
        console.log(`Updated roles for user ${member.user.tag}: removed ${oldRoleId}, added ${newRoleId}`);

        try {
            const dmContainer = new ContainerBuilder();
            const block = buildTextBlock({ title: 'League Application Approved',
                subtitle: application.league_name, lines: [
                `Your application to upgrade to **${application.applied_league_level} League** has been approved.`,
                'Please navigate to #league-owners for further instructions.'
            ] });
            if (block) dmContainer.addTextDisplayComponents(block);
            await member.send({ flags: MessageFlags.IsComponentsV2, components: [dmContainer] });
            console.log('Approval DM sent to the applicant.');
        } catch (error) {
            console.error('Error sending DM to the applicant:', error);
        }

        const message = interaction.message;
        const leagueApprovedContainer = new ContainerBuilder();
        const block = buildTextBlock({ title: 'League Application Approved',
            subtitle: application.league_name, lines: ['This application has been approved.'] });
            if (block) leagueApprovedContainer.addTextDisplayComponents(block);
        await message.edit({ flags: MessageFlags.IsComponentsV2, components: [leagueApprovedContainer] });
        console.log('Updated application message to indicate approval.');

        await interaction.reply({
            ...noticePayload(
                'Application has been approved.',
                { title: 'Approved', subtitle: application.league_name}
            ),
            ephemeral: true
        });
    } catch (error) {
        console.error('Error in handleApproveLeague:', error);
    } finally {
        await pgClient.end();
    }
};

const handleDenyLeagueModal = async (interaction) => {
    console.log('handleDenyLeagueModal called with customId:', interaction.customId);
    let pgClient;
    try {
        const denialReason = interaction.fields.getTextInputValue('denial-reason');
        console.log('Denial reason:', denialReason);

        const [action, messageId] = interaction.customId.split(':');
        console.log('Action:', action, 'Message ID:', messageId);

        pgClient = new Client(clientConfig);
        await pgClient.connect();

        const res = await pgClient.query('SELECT * FROM "League Applications" WHERE application_message_id = $1', [messageId]);
        console.log('Database query result:', res.rows);

        if (res.rows.length === 0) {
            await interaction.reply({
                ...noticePayload(
                    'League application not found.',
                    { title: 'Not Found', subtitle: 'League Applications'}
                ),
                ephemeral: true
            });
            return;
        }

        const application = res.rows[0];

        let member;
        try {
            member = await interaction.guild.members.fetch(application.applicant_id);
            console.log('Fetched member:', member.user.tag);
        } catch (error) {
            console.error('Error fetching member:', error);
            await interaction.reply({
                ...noticePayload(
                    'Could not fetch the applicant.',
                    { title: 'Member Unavailable', subtitle: 'League Applications'}
                ),
                ephemeral: true
            });
            return;
        }

        await pgClient.query(
            'UPDATE "League Applications" SET review_status = $1, denial_reason = $2, reviewed_date = NOW(), reviewed_by = $3 WHERE application_message_id = $4',
            ['Denied', denialReason, interaction.user.id, messageId]
        );
        console.log('Application status updated in the database.');

        try {
            const dmContainer = new ContainerBuilder();
            const block = buildTextBlock({ title: 'League Application Denied',
                subtitle: application.league_name, lines: [
                `Your application to upgrade your league has been denied.`,
                `**Reason:** ${denialReason}`,
                'A Community Developer will follow up with more details.'
            ] });
            if (block) dmContainer.addTextDisplayComponents(block);
            await member.send({ flags: MessageFlags.IsComponentsV2, components: [dmContainer] });
            console.log('DM sent to the applicant.');
        } catch (error) {
            console.error('Error sending DM to the applicant:', error);
        }
        try {
            const applicationChannel = interaction.channel;

            const message = await applicationChannel.messages.fetch(messageId);
            const leagueDeniedContainer = new ContainerBuilder();
            const block = buildTextBlock({ title: 'League Application Denied',
                subtitle: application.league_name, lines: ['This application has been denied.'] });
            if (block) leagueDeniedContainer.addTextDisplayComponents(block);
            await message.edit({ flags: MessageFlags.IsComponentsV2, components: [leagueDeniedContainer] });
            console.log('Application message updated.');
        } catch (error) {
            console.error('Error updating application message:', error);
        }

        await interaction.reply({
            ...noticePayload(
                'Application has been denied.',
                { title: 'Denied', subtitle: application.league_name}
            ),
            ephemeral: true
        });

    } catch (error) {
        console.error('Error in handleDenyLeagueModal:', error);
        if (!interaction.replied && !interaction.deferred) {
            try {
                await interaction.reply({
                    ...noticePayload(
                        'An error occurred while processing the denial.',
                        { title: 'Denial Failed', subtitle: 'League Applications'}
                    ),
                    ephemeral: true
                });
            } catch (replyError) {
                console.error('Error replying to interaction:', replyError);
            }
        }
    } finally {
        if (pgClient) {
            await pgClient.end();
        }
    }
};

const handleDenyLeagueButton = async (interaction) => {
    const modal = new ModalBuilder()
        .setCustomId(`denyLeagueModal:${interaction.message.id}`)
        .setTitle('Deny League Application');

    const denialReasonInput = new TextInputBuilder()
        .setCustomId('denial-reason')
        .setLabel('Reason for Denial')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

    const firstActionRow = new ActionRowBuilder().addComponents(denialReasonInput);
    modal.addComponents(firstActionRow);
    console.log('Creating modal with customId:', modal.data.custom_id);
    await interaction.showModal(modal);
};

const handleNext2 = async (interaction) => {
    try {
        await interaction.deferUpdate();

        const messageId = interaction.message.id;
        const paginationData = interaction.client.commandData.get(messageId);

        if (!paginationData) {
            console.error(`No pagination data found for message ID: ${messageId}`);
            return interaction.followUp({
                ...noticePayload(
                    'Pagination data not found or has expired.',
                    { title: 'Pagination Expired', subtitle: 'Quality Scores'}
                ),
                ephemeral: true
            });
        }

        const { posts, totalPages, username, userAvatar, runningAverage, weeklyAverages, embedColor, platform, seasonStart } = paginationData;
        let { currentPage } = paginationData;

        currentPage += 1;

        if (currentPage > totalPages) {
            currentPage = totalPages;
        }

        paginationData.currentPage = currentPage;
        interaction.client.commandData.set(messageId, paginationData);

        let container;
        const colorHex = typeof embedColor === 'string' ? parseInt(embedColor.replace('#', ''), 16) : (embedColor || 0x0099ff);
        if (currentPage === 1) {
            const weeklyFields = Object.entries(weeklyAverages)
                .sort((a, b) => {
                    const weekA = parseWeek(a[0]);
                    const weekB = parseWeek(b[0]);
                    if (weekA === null && weekB === null) return 0;
                    if (weekA === null) return 1;
                    if (weekB === null) return -1;
                    return weekA - weekB;
                })
                .slice(0, 20)
                .map(([week, score]) => {
                    const parsedWeek = parseWeek(week);
                    const label = parsedWeek === null ? week : parsedWeek;
                    return `📅 **Week ${label}:** ${score}`;
                });

            container = new ContainerBuilder()
                .setAccentColor(colorHex);
            const summaryLines = [
                `**Running Average (Season):** ${runningAverage}`,
                `**Total Posts:** ${posts.length}`,
                `**Season Start:** ${(seasonStart && seasonStart.display) ? seasonStart.display : 'N/A'}`
            ];
            if (platform) summaryLines.push(`**Platform:** ${platform}`);
            const weeklyLines = weeklyFields.length > 0
                ? weeklyFields.map(line => line.replace(/^📅\\s*/, ''))
                : ['**Weekly Averages:** No weekly data available.'];
            const block = buildTextBlock({
                title: `${username}'s Quality Scores`,
                subtitle: platform ? `${platform} overview` : 'Season overview',
                lines: [...summaryLines, '', ...weeklyLines]
            });
            if (block) container.addTextDisplayComponents(block);
        } else {
            const postIndex = currentPage - 2;
            const post = posts[postIndex];

            if (!post) {
                throw new Error('Post data not found for the current page.');
            }

            container = new ContainerBuilder()
                .setAccentColor(colorHex);
            const block = buildTextBlock({
                title: `${username}'s Quality Score`,
                subtitle: `Post ${currentPage - 1} of ${totalPages - 1}`,
                lines: [
                    `**Score:** ${post.score}`,
                    `**Likes:** ${post.likes}`,
                    `**Points:** ${post.points ? post.points : 'N/A'}`,
                    `**Views:** ${post.views}`,
                    `**Season Week:** ${post.week !== null ? `Week ${post.week}` : 'N/A'}`,
                    `**Platform:** ${post.platform || platform || 'N/A'}`,
                    `**Post Date:** ${post.postDateDisplay || 'N/A'}`,
                    `**URL:** ${post.url}`,
                    `**Details:** ${post.details}`
                ]
            });
            if (block) container.addTextDisplayComponents(block);
        }

        const prevButton = new ButtonBuilder()
            .setCustomId('prev2')
            .setLabel('Previous')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(currentPage === 1);

        const nextButton = new ButtonBuilder()
            .setCustomId('next2')
            .setLabel('Next')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(currentPage === totalPages);

        const actionRow = new ActionRowBuilder().addComponents(prevButton, nextButton);

        await interaction.editReply({
            flags: MessageFlags.IsComponentsV2,
            components: [container, actionRow] });

    } catch (error) {
        console.error('Error handling Next pagination:', error.message);
    }
};

const handlePrev2 = async (interaction) => {
    try {
        await interaction.deferUpdate();

        const messageId = interaction.message.id;
        const paginationData = interaction.client.commandData.get(messageId);

        if (!paginationData) {
            console.error(`No pagination data found for message ID: ${messageId}`);
            return interaction.followUp({
                ...noticePayload(
                    'Pagination data not found or has expired.',
                    { title: 'Pagination Expired', subtitle: 'Quality Scores'}
                ),
                ephemeral: true
            });
        }

        const { posts, totalPages, username, userAvatar, runningAverage, weeklyAverages, embedColor, platform, seasonStart } = paginationData;
        let { currentPage } = paginationData;

        currentPage -= 1;

        if (currentPage < 1) {
            currentPage = 1;
        }

        paginationData.currentPage = currentPage;
        interaction.client.commandData.set(messageId, paginationData);

        let container;
        const colorHex = typeof embedColor === 'string' ? parseInt(embedColor.replace('#', ''), 16) : (embedColor || 0x0099ff);
        if (currentPage === 1) {
            const weeklyFields = Object.entries(weeklyAverages)
                .sort((a, b) => {
                    const weekA = parseWeek(a[0]);
                    const weekB = parseWeek(b[0]);
                    if (weekA === null && weekB === null) return 0;
                    if (weekA === null) return 1;
                    if (weekB === null) return -1;
                    return weekA - weekB;
                })
                .slice(0, 20)
                .map(([week, score]) => {
                    const parsedWeek = parseWeek(week);
                    const label = parsedWeek === null ? week : parsedWeek;
                    return `📅 **Week ${label}:** ${score}`;
                });

            container = new ContainerBuilder()
                .setAccentColor(colorHex);
            const summaryLines = [
                `**Running Average (Season):** ${runningAverage}`,
                `**Total Posts:** ${posts.length}`,
                `**Season Start:** ${(seasonStart && seasonStart.display) ? seasonStart.display : 'N/A'}`
            ];
            if (platform) summaryLines.push(`**Platform:** ${platform}`);
            const weeklyLines = weeklyFields.length > 0
                ? weeklyFields.map(line => line.replace(/^📅\\s*/, ''))
                : ['**Weekly Averages:** No weekly data available.'];
            const block = buildTextBlock({
                title: `${username}'s Quality Scores`,
                subtitle: platform ? `${platform} overview` : 'Season overview',
                lines: [...summaryLines, '', ...weeklyLines]
            });
            if (block) container.addTextDisplayComponents(block);
        } else {
            const postIndex = currentPage - 2;
            const post = posts[postIndex];

            if (!post) {
                throw new Error('Post data not found for the current page.');
            }

            container = new ContainerBuilder()
                .setAccentColor(colorHex);
            const block = buildTextBlock({
                title: `${username}'s Quality Score`,
                subtitle: `Post ${currentPage - 1} of ${totalPages - 1}`,
                lines: [
                    `**Score:** ${post.score}`,
                    `**Likes:** ${post.likes}`,
                    `**Points:** ${post.points ? post.points : 'N/A'}`,
                    `**Views:** ${post.views}`,
                    `**Season Week:** ${post.week !== null ? `Week ${post.week}` : 'N/A'}`,
                    `**Platform:** ${post.platform || platform || 'N/A'}`,
                    `**Post Date:** ${post.postDateDisplay || 'N/A'}`,
                    `**URL:** ${post.url}`,
                    `**Details:** ${post.details}`
                ]
            });
            if (block) container.addTextDisplayComponents(block);
        }

        const prevButton = new ButtonBuilder()
            .setCustomId('prev2')
            .setLabel('Previous')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(currentPage === 1);

        const nextButton = new ButtonBuilder()
            .setCustomId('next2')
            .setLabel('Next')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(currentPage === totalPages);

        const actionRow = new ActionRowBuilder().addComponents(prevButton, nextButton);

        await interaction.editReply({
            flags: MessageFlags.IsComponentsV2,
            components: [container, actionRow] });

    } catch (error) {
        console.error('Error handling Previous pagination:', error.message);
    }
};

const lfgRemoveFromOtherQueues = async (client, userId, targetQueueKey) => {
    const pgClient = new Client(clientConfig);
    await pgClient.connect();
    await pgClient.query(`CREATE TABLE IF NOT EXISTS lfg_queues (
      thread_id TEXT PRIMARY KEY,
      queue_key TEXT NOT NULL,
      queue_name TEXT NOT NULL,
      size INTEGER NOT NULL,
      status TEXT NOT NULL,
      participants TEXT[] NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    const res = await pgClient.query(
        'SELECT thread_id, queue_key, queue_name, size, participants FROM lfg_queues WHERE $1 = ANY(participants) AND queue_key <> $2',
        [userId, targetQueueKey]
    );
    for (const row of res.rows) {
        const newParticipants = row.participants.filter(p => p !== userId);
        await pgClient.query(
            `UPDATE lfg_queues
               SET participants = COALESCE($1::text[], ARRAY[]::text[]),
                   updated_at = NOW(),
                   status = CASE
                              WHEN array_length(COALESCE($1::text[], ARRAY[]::text[]),1) IS NULL
                                   OR array_length(COALESCE($1::text[], ARRAY[]::text[]),1) < size
                              THEN 'waiting'
                              ELSE 'ready'
                            END
             WHERE thread_id = $2`,
            [newParticipants, row.thread_id]
        );
        const key = row.queue_key;
        const set = await lfgEnsureState(client, key);
        set.delete(userId);
        const qDef = LFG_QUEUES.find(q => q.key === key);
        try {
            const thread = await client.channels.fetch(row.thread_id).catch(() => null);
            if (thread && thread.isThread()) {
                await lfgUpdateStarterMessage(thread, qDef, set);
            }
        } catch (error) {
            console.error('Failed to update LFG starter message during removal:', error);
        }
    }
    await pgClient.end();
};

const lfgGetQueueDefByKey = async (key) => {
    const pgClient = new Client(clientConfig);
    await pgClient.connect();
    await pgClient.query(`CREATE TABLE IF NOT EXISTS lfg_queues (
      thread_id TEXT PRIMARY KEY,
      queue_key TEXT NOT NULL,
      queue_name TEXT NOT NULL,
      size INTEGER NOT NULL,
      status TEXT NOT NULL,
      participants TEXT[] NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    const res = await pgClient.query(
        `SELECT queue_key, queue_name, size,
                COALESCE(description,'') AS description,
                COALESCE(lobby_display_name,'') AS lobby_display_name
           FROM lfg_queues
          WHERE queue_key = $1
          ORDER BY updated_at DESC
          LIMIT 1`,
        [key]
    );
    await pgClient.end();
    if (!res.rows[0]) return null;
    return { key: res.rows[0].queue_key, name: res.rows[0].queue_name, size: res.rows[0].size, description: res.rows[0].description, lobby_display_name: res.rows[0].lobby_display_name };
};

const lfgGetQueueDefByThreadId = async (threadId) => {
    const pgClient = new Client(clientConfig);
    await pgClient.connect();
    await pgClient.query(`CREATE TABLE IF NOT EXISTS lfg_queues (
      thread_id TEXT PRIMARY KEY,
      queue_key TEXT NOT NULL,
      queue_name TEXT NOT NULL,
      size INTEGER NOT NULL,
      status TEXT NOT NULL,
      participants TEXT[] NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    const res = await pgClient.query(
        `SELECT queue_key, queue_name, size,
                COALESCE(description,'') AS description,
                COALESCE(lobby_display_name,'') AS lobby_display_name
           FROM lfg_queues
          WHERE thread_id = $1
          LIMIT 1`,
        [threadId]
    );
    await pgClient.end();
    if (!res.rows[0]) return null;
    return { key: res.rows[0].queue_key, name: res.rows[0].queue_name, size: res.rows[0].size, description: res.rows[0].description, lobby_display_name: res.rows[0].lobby_display_name };
};

const handleLfgButton = async (interaction) => {
    try {
        await interaction.deferReply({ flags: 64 });
        if (!interaction.channel || !interaction.channel.isThread()) {
            await interaction.editReply(
                noticePayload(
                    'This button can only be used inside its queue thread.',
                    { title: 'Queue Action', subtitle: 'Wrong Channel'}
                )
            );
            return;
        }
        const parts = interaction.customId.split(':');
        const lfgAction = parts[1];
        const lfgKey = parts[2];
        let queueDef = null;
        if (lfgKey) queueDef = await lfgGetQueueDefByKey(lfgKey);
        if (!queueDef && interaction.channel && interaction.channel.id) {
            queueDef = await lfgGetQueueDefByThreadId(interaction.channel.id);
        }
        if (!queueDef && typeof LFG_QUEUES !== 'undefined') {
            queueDef = LFG_QUEUES.find(q => q.key === lfgKey) || (interaction.channel ? LFG_QUEUES.find(q => q.name === interaction.channel.name) : null);
        }
        if (!queueDef) {
            await interaction.editReply(
                noticePayload(
                    'Queue not found for this thread.',
                    { title: 'Queue Not Found', subtitle: 'LFG Queue'}
                )
            );
            return;
        }
        const members = await lfgEnsureState(interaction.client, queueDef.key);
        if (!members) {
            await interaction.editReply(
                noticePayload(
                    'Queue state unavailable.',
                    { title: 'Queue Unavailable', subtitle: queueDef.name}
                )
            );
            return;
        }
        if (lfgAction === 'join') {
            if (members.has(interaction.user.id)) {
                await interaction.editReply(
                    noticePayload(
                        `You are already in ${queueDef.name}.`,
                        { title: 'Already Joined', subtitle: queueDef.name}
                    )
                );
                return;
            }
            await lfgRemoveFromOtherQueues(interaction.client, interaction.user.id, queueDef.key);
            members.add(interaction.user.id);
            const ordered = [...members];
            if (ordered.length >= queueDef.size) {
                const picks = ordered.slice(0, queueDef.size);
                const remaining = ordered.slice(queueDef.size);
                members.clear();
                for (const id of remaining) members.add(id);
                await lfgUpdateStarterMessage(interaction.channel, queueDef, members);
                const status1 = await lfgGetStatus(members, queueDef);
                await lfgUpsertRow(interaction.channel.id, queueDef, members, status1);
                const client = interaction.client;
                let fallback = null;
                try {
                    fallback = await client.channels.fetch('752216589792706624');
                } catch (fetchError) {
                    console.error('Failed to fetch fallback channel for queue notification:', fetchError);
                }
                for (const uid of picks) {
                    const others = picks.filter(id => id !== uid);
                    const gym = (queueDef.lobby_display_name && queueDef.lobby_display_name.trim().length > 0) ? queueDef.lobby_display_name : 'the gym';
                    let delivered = false;
                    try {
                        const user = await client.users.fetch(uid);
                        await user.send(
                            noticePayload(
                                [
                                    `**Queue:** ${queueDef.name}`,
                                    `**Opponent(s):** ${others.map(id => `<@${id}>`).join(' ') || 'TBD'}`,
                                    `**Lobby:** ${gym}`,
                                    'Your match is ready. Head in and play!'
                                ],
                                { title: 'Match Ready', subtitle: queueDef.name}
                            )
                        );
                        delivered = true;
                    } catch (dmError) {
                        console.error('Failed to notify user about LFG queue update:', dmError);
                    }
                    if (!delivered && fallback) {
                        await fallback.send(
                            noticePayload(
                                [
                                    `<@${uid}>`,
                                    `**Queue:** ${queueDef.name}`,
                                    `**Opponent(s):** ${others.map(id => `<@${id}>`).join(' ') || 'TBD'}`,
                                    `**Lobby:** ${gym}`,
                                    'Your match is ready. Head in and play!'
                                ],
                                { title: 'Match Ready', subtitle: queueDef.name}
                            )
                        );
                    }
                }
                if (picks.includes(interaction.user.id)) {
                    await interaction.editReply(
                        noticePayload(
                            `Match ready in ${queueDef.name}.`,
                            { title: 'Match Ready', subtitle: queueDef.name}
                        )
                    );
                } else {
                    const pos = remaining.indexOf(interaction.user.id) + 1;
                    await interaction.editReply(
                        noticePayload(
                            `Joined ${queueDef.name}. You are in the wait list at position ${pos}.`,
                            { title: 'Queued', subtitle: queueDef.name}
                        )
                    );
                }
                return;
            }
            await lfgUpdateStarterMessage(interaction.channel, queueDef, members);
            const status2 = await lfgGetStatus(members, queueDef);
            await lfgUpsertRow(interaction.channel.id, queueDef, members, status2);
            await interaction.editReply(
                noticePayload(
                    `Joined ${queueDef.name}.`,
                    { title: 'Queued', subtitle: queueDef.name}
                )
            );
            return;
        }
        if (lfgAction === 'leave') {
            if (!members.has(interaction.user.id)) {
                await interaction.editReply(
                    noticePayload(
                        `You are not in ${queueDef.name}.`,
                        { title: 'Not In Queue', subtitle: queueDef.name}
                    )
                );
                return;
            }
            members.delete(interaction.user.id);
            await lfgUpdateStarterMessage(interaction.channel, queueDef, members);
            const status3 = await lfgGetStatus(members, queueDef);
            await lfgUpsertRow(interaction.channel.id, queueDef, members, status3);
            await interaction.editReply(
                noticePayload(
                    `Left ${queueDef.name}.`,
                    { title: 'Queue Updated', subtitle: queueDef.name}
                )
            );
            return;
        }
        if (lfgAction === 'status') {
            const status4 = await lfgGetStatus(members, queueDef);
            await lfgUpsertRow(interaction.channel.id, queueDef, members, status4);
            await interaction.editReply(
                noticePayload(
                    `${members.size}/${queueDef.size} waiting in ${queueDef.name}.`,
                    { title: 'Queue Status', subtitle: queueDef.name}
                )
            );
            return;
        }
    } catch (error) {
        console.error('Button Error', error);
        try {
            if (!interaction.deferred && !interaction.replied) {
                await interaction.reply({
                    ...noticePayload(
                        'An error occurred while processing this button.',
                        { title: 'Action Failed', subtitle: 'LFG Queue'}
                    ),
                    ephemeral: true
                });
            } else {
                await interaction.editReply(
                    noticePayload(
                        'An error occurred while processing this button.',
                        { title: 'Action Failed', subtitle: 'LFG Queue'}
                    )
                );
            }
        } catch (replyError) {
            console.error('Failed to send error response for button interaction:', replyError);
        }
    }
};

const LFG_QUEUES = [
    { key: 'casual_1v1', name: 'Casual 1v1', size: 2, description: 'Casual 1v1 matches.' },
    { key: 'casual_2v2', name: 'Casual 2v2', size: 4, description: 'Casual 2v2 matches.' },
    { key: 'comp_1v1', name: 'Comp 1v1', size: 2, description: 'Competitive 1v1 matches.' },
    { key: 'comp_2v2', name: 'Comp 2v2', size: 4, description: 'Competitive 2v2 matches.' }
];

const lfgEnsureState = async (client, key) => {
    if (!client.lfgQueues) client.lfgQueues = new Map();
    if (client.lfgQueues.has(key)) return client.lfgQueues.get(key);
    const pgClient = new Client(clientConfig);
    await pgClient.connect();
    await pgClient.query(`CREATE TABLE IF NOT EXISTS lfg_queues (
      thread_id TEXT PRIMARY KEY,
      queue_key TEXT NOT NULL,
      queue_name TEXT NOT NULL,
      size INTEGER NOT NULL,
      status TEXT NOT NULL,
      participants TEXT[] NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    const res = await pgClient.query('SELECT participants FROM lfg_queues WHERE queue_key = $1 ORDER BY updated_at DESC LIMIT 1', [key]);
    await pgClient.end();
    const s = new Set((res.rows[0]?.participants || []).map(x => x));
    client.lfgQueues.set(key, s);
    return s;
};

const lfgBuildButtons = (key) => {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`lfg:join:${key}`).setLabel('Join').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`lfg:leave:${key}`).setLabel('Leave').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`lfg:status:${key}`).setLabel('Status').setStyle(ButtonStyle.Primary)
    );
};

const lfgBuildContainer = (queue, members, imageName) => {
    const list = members.size ? [...members].map(id => `<@${id}>`).join(' \u2022 ') : 'None';
    const container = new ContainerBuilder();
    const block = buildTextBlock({ title: `${queue.name} Queue`,
        subtitle: queue.description || 'Queue status', lines: [
        `**Players Needed:** ${members.size}/${queue.size}`,
        `**Waiting:** ${list}`,
        'Use the buttons below to join or leave the queue.'
    ] });
            if (block) container.addTextDisplayComponents(block);
    if (imageName) {
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL(`attachment://${imageName}`)
            )
        );
    }
    return container;
};

const fetchBuffer = async (url) => {
    const res = await request(url);
    const ab = await res.body.arrayBuffer();
    return Buffer.from(ab);
};

const generateQueueImage = async (client, queue, members) => {
    const bgBuf = await fetchBuffer('https://cdn.ballhead.app/web_assets/FORCDN.jpg');
    const bg = await loadImage(bgBuf);
    const canvas = createCanvas(bg.width, bg.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bg, 0, 0, bg.width, bg.height);
    const txt = `${members.size}/${queue.size}`;
    const fs = Math.floor(bg.height * 0.12);
    ctx.font = `bold ${fs}px Sans-Serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = Math.max(6, Math.floor(bg.height * 0.01));
    const tx = Math.floor(bg.width / 2);
    const ty = Math.floor(bg.height * 0.8);
    const textWidth = ctx.measureText(txt).width;
    const headR = Math.floor(fs * 0.22);
    const iconGap = Math.floor(fs * 0.35);
    const headCx = Math.floor(tx - textWidth / 2 - iconGap - 20);
    const headCy = Math.floor(ty - headR);
    ctx.beginPath();
    ctx.arc(headCx, headCy, headR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    const bodyW = Math.floor(headR * 2.6);
    const bodyH = Math.floor(headR * 2.2);
    const bodyX = Math.floor(headCx - bodyW / 2);
    const bodyY = Math.floor(headCy + headR * 0.9);
    const rr = Math.floor(headR * 0.6);
    ctx.beginPath();
    ctx.moveTo(bodyX + rr, bodyY);
    ctx.lineTo(bodyX + bodyW - rr, bodyY);
    ctx.arc(bodyX + bodyW - rr, bodyY + rr, rr, -Math.PI / 2, 0);
    ctx.lineTo(bodyX + bodyW, bodyY + bodyH - rr);
    ctx.arc(bodyX + bodyW - rr, bodyY + bodyH - rr, rr, 0, Math.PI / 2);
    ctx.lineTo(bodyX + rr, bodyY + bodyH);
    ctx.arc(bodyX + rr, bodyY + bodyH - rr, rr, Math.PI / 2, Math.PI);
    ctx.lineTo(bodyX, bodyY + rr);
    ctx.arc(bodyX + rr, bodyY + rr, rr, Math.PI, Math.PI * 1.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeText(txt, tx, ty);
    ctx.fillText(txt, tx, ty);
    const buffer = canvas.toBuffer('image/png');
    const name = `${queue.key}.png`;
    return { attachment: buffer, name };
};

const lfgUpdateStarterMessage = async (thread, queueDef, members) => {
    const starter = await thread.fetchStarterMessage().catch(() => null);
    if (!starter) return;
    const img = await generateQueueImage(thread.client, queueDef, members);
    const isV2 = starter?.flags?.has?.(MessageFlags.IsComponentsV2);
    if (!isV2) {
        try {
            await starter.edit({ embeds: [] });
        } catch (error) {
            console.warn('Failed to clear legacy embeds before v2 update:', error?.message || error);
            return;
        }
    }
    const editOptions = {
        files: [img],
        flags: MessageFlags.IsComponentsV2,
        components: [lfgBuildContainer(queueDef, members, img.name), lfgBuildButtons(queueDef.key)]
    };
    if (isV2) {
        delete editOptions.flags;
    }
    await starter.edit(editOptions);
};

const lfgUpsertRow = async (threadId, queueDef, members, status) => {
    const pgClient = new Client(clientConfig);
    await pgClient.connect();
    await pgClient.query(`CREATE TABLE IF NOT EXISTS lfg_queues (
      thread_id TEXT PRIMARY KEY,
      queue_key TEXT NOT NULL,
      queue_name TEXT NOT NULL,
      size INTEGER NOT NULL,
      status TEXT NOT NULL,
      participants TEXT[] NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await pgClient.query(`DO $$
    BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_constraint WHERE conname = 'lfg_queues_pkey'
     ) THEN
       ALTER TABLE lfg_queues ADD CONSTRAINT lfg_queues_pkey PRIMARY KEY (thread_id);
     END IF;
    END$$;`);
    const participants = Array.from(members);
    await pgClient.query(
        `INSERT INTO lfg_queues(thread_id, queue_key, queue_name, size, status, participants, updated_at)
         VALUES($1,$2,$3,$4,$5,$6,NOW())
         ON CONFLICT (thread_id) DO UPDATE SET queue_key=EXCLUDED.queue_key, queue_name=EXCLUDED.queue_name, size=EXCLUDED.size, status=EXCLUDED.status, participants=EXCLUDED.participants, updated_at=NOW()`,
        [threadId, queueDef.key, queueDef.name, queueDef.size, status, participants]
    );
    await pgClient.end();
};

const lfgGetStatus = async (members, queueDef) => {
    if (members.size >= queueDef.size) return 'ready';
    return 'waiting';
};

const handleFFLeaderboardSelect = async (interaction) => {
    const category = interaction.values[0] || FF_LEADERBOARD_DEFAULT_CATEGORY;
    await interaction.deferUpdate();
    try {
        const result = await buildFriendlyFireLeaderboardPayload(category);
        if (result.errorContainer) {
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [result.errorContainer] });
            return;
        }
        await interaction.editReply({
            flags: MessageFlags.IsComponentsV2,
            components: result.components,
            files: result.files
        });
    } catch (error) {
        console.error('Error updating Friendly Fire leaderboard:', error);
        try {
            const errorGuild = await interaction.client.guilds.fetch(FF_LEADERBOARD_ERROR_LOG_GUILD_ID);
            const errorChannel = await errorGuild.channels.fetch(FF_LEADERBOARD_ERROR_LOG_CHANNEL_ID);
            const errorContainer = new ContainerBuilder();
            const block = buildTextBlock({
                title: 'Leaderboard Update Error',
                subtitle: 'Friendly Fire leaderboard failed',
                lines: [`**Error:** ${error.message}`]
            });
            if (block) errorContainer.addTextDisplayComponents(block);
            await errorChannel.send({ flags: MessageFlags.IsComponentsV2, components: [errorContainer] });
        } catch (logError) {
            console.error('Failed to log FF leaderboard error:', logError);
        }
        await interaction.followUp({
            ...noticePayload(
                'An error occurred while updating the leaderboard.',
                { title: 'Leaderboard Error', subtitle: 'Friendly Fire'}
            ),
            ephemeral: true
        }).catch(console.error);
    }
}

function buildTextBlock({ title, subtitle, lines } = {}) {
    const parts = [];
    if (title) {
        parts.push(`## ${title}`);
    }
    if (subtitle) {
        parts.push(subtitle);
    }
    if (Array.isArray(lines) && lines.length > 0) {
        if (parts.length > 0) {
            parts.push('');
        }
        parts.push(...lines.filter(Boolean));
    }
    if (parts.length === 0) {
        return null;
    }
    return new TextDisplayBuilder().setContent(parts.join('\n'));
}


function parseWeek(value) {
    if (!value) {
        return null;
    }
    const match = value.toString().match(/(\d+)/);
    if (!match) {
        return null;
    }
    const number = parseInt(match[1], 10);
    return Number.isNaN(number) ? null : number;
}

function buildNoticeContainer({ title = 'Notice', subtitle, lines} = {}) {
    const container = new ContainerBuilder();
    const block = buildTextBlock({ title, subtitle, lines });
    if (block) container.addTextDisplayComponents(block);
    return container;
}

function noticePayload(message, options = {}) {
    const lines = Array.isArray(message) ? message : [message];
    const container = buildNoticeContainer({ ...options, lines });
    return { flags: MessageFlags.IsComponentsV2, components: [container] };
}
module.exports = interactionHandler;
