'use strict';
require('dotenv').config({ path: './resources/.env' });
const logCommandUsage = require('./API/command-data');
const { fetchInviteById, updateInviteStatus, deleteInvite, fetchSquadApplicationByMessageUrl, deleteSquadApplicationById } = require('./db');
const credentials = require('./resources/secret.json');

const { ActionRowBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, Collection } = require('discord.js');
const { google } = require('googleapis');
const { createModal } = require('./modals/modalFactory');
const { Client } = require('pg');
const BALLHEAD_GUILD_ID = '1233740086839869501';

const BOT_BUGS_CHANNEL_ID = '1233853458092658749';
const USER_BUG_REPORTS_CHANNEL_ID = '1233853364035522690';
const sheets= google.sheets({ version: 'v4', auth: authorize() });
const DISCORD_BOT_TOKEN = process.env.TOKEN
const SEASON_YEAR = 2025

const SQUAD_APPLICATIONS_CHANNEL_ID = '1218466649695457331';
const GYMCLASSVR_GUILD_ID = '752216589792706621';
const BOT_ACTIVITIES_CHANNEL_ID = '1233854185276051516';
const BOT_ACTIONS_CHANNEL_ID = '1233853415952748645';

const clientConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    database: process.env.DB_DATABASE_NAME,
    password: process.env.DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
};

function authorize() {
    const { client_email, private_key } = credentials;
    const auth = new google.auth.JWT(
        client_email,
        null,
        private_key,
        ['https://www.googleapis.com/auth/spreadsheets']
    );
    return auth;
}

const interactionHandler = async (interaction, client) => {
    try {
        if (interaction.isCommand()) {
            const command = client.commands.get(interaction.commandName);
            if (!command) return;
            await logCommandUsage(interaction);
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
                content: 'We encounter an error occurred while processing your request. \n -# if this issue persists please reach out to support to escalate your issue to the developers \n -# Do note, this error has been logged internally and will be investigated.',
                ephemeral: true
            }).catch((err) => {
                if (err.code === 10062) {
                    console.error("Interaction expired and cannot be replied to.");
                } else {
                    console.error("Failed to reply to interaction:", err);
                }
            });
        }

        try {
            const errorGuild = await interaction.client.guilds.fetch(BALLHEAD_GUILD_ID);
            const errorChannel = await errorGuild.channels.fetch(BOT_BUGS_CHANNEL_ID);
            const errorEmbed = new EmbedBuilder()
                .setTitle('Error')
                .setDescription(`An error occurred while processing an interaction: ${error.message}`)
                .setColor(0xFF0000);
            await errorChannel.send({ embeds: [errorEmbed] });
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
                content: `You are on cooldown for the \`${command.data.name}\` command. Please wait ${timeLeft} second(s) before using it again.`,
                ephemeral: true,
            });
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
                content: 'We encountered an error while processing the command. If this issue persists, please contact support.',
            }).catch((err) => {
                if (err.code === 10062) {
                    console.error("Interaction expired and cannot be edited.");
                } else {
                    console.error("Failed to edit reply:", err);
                }
            });
        } else {
            await interaction.reply({
                content: 'An error occurred while executing the command.',
                ephemeral: true,
            }).catch((err) => {
                if (err.code === 10062) {
                    console.error("Interaction expired and cannot be replied to.");
                } else {
                    console.error("Failed to reply to an interaction:", err);
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
            await interaction.reply({ content: "We encounter an error occurred while processing your modal submission. \n -# if this issue persists please reach out to support to escalate your issue to the developers \n -# Do note, this error has been logged internally and will be investigated.", ephemeral: true });
        }
    }
};

const handleModalSubmit = async (interaction, client) => {
    const [action, customId] = interaction.customId.split(':');

    if (action === 'report-bug') {
        await handleBugReport(interaction, customId);
    } else if (action === 'officialApplicationModal') {
        await handleOfficialsApplicationSubmission(interaction);
    } else if (action === 'LfgSystem2Create') {
        await handleLfgSystem2Create(interaction);
    } else if (action === 'LfgSystem1Create') {
        await handleLfgSystem1Create(interaction);
    } else if (action === 'generateTemplateModal_kotc' || action === 'generateTemplateModal_gc') {
        await handleGenerateTemplateModal(interaction);
    } else if (action === 'apply-base-league-modal') {
        await handleApplyBaseLeagueModal(interaction);
    } else if (action === 'denyLeagueModal') {
        await handleDenyLeagueModal(interaction);
    } else if (action === 'LfgSystem3Create') {
        await handleLfgSystem3Create(interaction);
    }else console.warn('Unhandled modal action:', action);
    await interaction.reply({ content: 'This modal is not recognized.', ephemeral: true });
};

const handleButton = async(interaction, client) => {
    try {
        const [action, customId] = interaction.customId.split('_');
        if (!interaction.isButton() || interaction.message.partial) {
            await interaction.message.fetch();
        }
        if (action === 'invite') {
            await handleInviteButton(interaction, customId);
        } else if (action === 'application') {
            await handleApplicationButton(interaction, customId, client);
        } else if (action === 'pagination1') {
            await handlePagination1(interaction, customId);
        } else if (action === 'next2') {
            await handleNext2(interaction, customId);
        } else if (action === 'prev2') {
            await handlePrev2(interaction, customId);
        } else if (action === 'LfgSystem2ViewRoster') {
            await hanldeviewRoster(interaction, client);
        } else if (action === 'LfgSystem2Join') {
            await handleLfgSystem2Join(interaction, client);
        } else if (action === 'LfgSystem2ClosePost') {
            await handleLfgSystem2Close (interaction, client);
        } else if (action === 'approve') {
            await handleOfficialsApplicationApprove(interaction, client);
        } else if (action === 'reject') {
            await handleOfficialsApplicationReject(interaction, client);
        } else if (action === 'officialsQna') {
            await handleQnAInteraction(interaction);
        } else if (action === 'officialsQnaReject') {
            await handleNextStepsInteraction(interaction);
        } else if (action === 'lfgSystem1Close') {
            await handleLfgSystem1Close (interaction);
        } else if (action === 'lfgSystem1Join') {
            await handleLfgSystem1Join(interaction);
        } else if (action === 'lfgSystem1ViewParticipants') {
            await handleLfgSystem1ViewParticipants(interaction);
        } else if (action === 'approveLeague') {
            await handleApproveLeague(interaction);
        } else if (action === 'denyLeague') {
            await handleDenyLeagueButton (interaction);
        } else if (action === 'lfgSystem3Join') {
            await handleLfgSystem3Join(interaction);
        } else if (action === 'lfgSystem3Close') {
            await handleLfgSystem3Close(interaction);
        } else {
            await interaction.reply({ content: 'We encounter an error occurred while processing your button interaction. \n-# if this issue persists please reach out to support to escalate your issue to the developers \n-# Do note, this error has been logged internally and will be investigated.', ephemeral: true });
        }
    } catch (error) {
        console.error('Button Error', error);
        if (!interaction.replied) {
            await interaction.reply({ content: '', ephemeral: true });
        }
    }
};

const handleBugReport = async (interaction, client, customId) => {
    const commandName = customId;
    const errorReceived = interaction.fields.getTextInputValue('bug-error');
    const steps = interaction.fields.getTextInputValue('bug-steps');

    try {
        const loggingGuild = await interaction.client.guilds.fetch(BALLHEAD_GUILD_ID);
        const loggingChannel = await loggingGuild.channels.fetch(USER_BUG_REPORTS_CHANNEL_ID);
        await loggingChannel.send({embeds: [logEmbed]});
        await interaction.reply({
            content: 'Thank you for reporting the bug. The development team has been notified.',
            ephemeral: true
        });
    } catch (error) {
        console.error('Failed to log bug report:', error);
        await interaction.reply({
            content: 'Ironically.... There was an error logging your bug report the developers have been notified \n-# if this issue persists please reach out to support to escalate your issue.',
            ephemeral: true
        });

        try {
            const errorGuild = await interaction.client.guilds.fetch(BALLHEAD_GUILD_ID);
            const errorChannel = await errorGuild.channels.fetch(BOT_BUGS_CHANNEL_ID);
            const errorEmbed = new EmbedBuilder()
                .setTitle('Error')
                .setDescription(`An error occurred while logging a bug report: ${error.message}`)
                .setColor(0xFF0000);
            await errorChannel.send({embeds: [errorEmbed]});
        } catch (logError) {
            console.error('Failed to log error:', logError);
        }
    }

    const logEmbed = new EmbedBuilder()
        .setTitle('Bug Report')
        .setDescription(`Bug was reported for the command \`${commandName}\``)
        .addFields(
            {name: ["Reported By"], value: `<@${interaction.user.id}>`},
            {name: ["Error Received"], value: errorReceived},
            {name: ["Steps to Reproduce"], value: steps || 'Not provided'}
        )
        .setColor(0xFF0000);
}


const handleLfgSystem2Create = async (interaction) => {
    await interaction.deferReply({ephemeral: true});

    const requirements = interaction.fields.getTextInputValue('requirementsSystem2');
    const rules = interaction.fields.getTextInputValue('rulesSystem2') || null;
    const additionalInfo = interaction.fields.getTextInputValue('additionalInfoSystem2') || null;

    const squadData = await sheets.spreadsheets.values.get({
        spreadsheetId: '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k',
        range: 'Squad Leaders!A2:D',
    });

    const squadRows = squadData.data.values;
    const squad = squadRows.find(row => row[1] === interaction.user.id);

    if (!squad) {
        return interaction.editReply({content: 'Squad information not found for your account.'});
    }

    const squadName = squad[2];

    let description = `Hello all 👋, <@${interaction.user.id}> is looking for members to join their squad **${squadName}**! \n\n**Here are their requirements:**\n${requirements}`;

    if (rules) {
        description += `\n\n**Here are the rules in the squad:**\n${rules}`;
    }

    if (additionalInfo) {
        description += `\n\n**Here is additional information:**\n${additionalInfo}`;
    }

    description += `\n\nIf you're interested, use the buttons below to join or view the roster!`;

    const joinTeamButton = new ButtonBuilder()
        .setCustomId('LfgSystem2Join')
        .setLabel('Join Team')
        .setStyle(ButtonStyle.Primary);

    const viewRosterButton = new ButtonBuilder()
        .setCustomId('LfgSystem2ViewRoster')
        .setLabel('View Roster')
        .setStyle(ButtonStyle.Secondary);

    const closePostButton = new ButtonBuilder()
        .setCustomId('LfgSystem2ClosePost')
        .setLabel('Close Post')
        .setStyle(ButtonStyle.Danger);

    const actionRow = new ActionRowBuilder().addComponents(joinTeamButton, viewRosterButton, closePostButton);

    const embed = new EmbedBuilder()
        .setDescription(description);

    const recruitmentChannel = interaction.guild.channels.cache.get('1281372149243969550');
    const recruitmentMessage = await recruitmentChannel.send({embeds: [embed], components: [actionRow]});

    const threadName = `${squadName}-Recruitment`;
    const thread = await recruitmentChannel.threads.create({
        name: threadName,
        autoArchiveDuration: 1440,
        type: 12,
        reason: 'Recruitment thread for squad',
    });

    await thread.members.add(interaction.user.id);
    await thread.send(`Welcome <@${interaction.user.id}>! This thread is for managing your recruitment process for the squad **${squadName}**.`);

    const client = new Client(clientConfig);
    await client.connect();

    try {
        await client.query('INSERT INTO "lfm_data" ("post_owner_discord_id", "post_message_id", "discord_thread_id", "participants") VALUES ($1, $2, $3, $4)', [
            interaction.user.id,
            recruitmentMessage.id,
            thread.id,
            [],
        ]);
    } finally {
        await client.end();
    }

    await interaction.editReply({content: 'Your squad recruitment post, private thread, and buttons have been created!'});

};

const handleOfficialsApplicationSubmission = async (interaction) => {
    console.log(`Running handleOfficialsApplicationSubmission`);

    try {
        const discordId = interaction.user.id;
        console.log(`User ID: ${discordId}`);

        const pgClient = new Client(clientConfig);
        await pgClient.connect();
        console.log(`Connected to PostgreSQL`);

        const existingApplication = await pgClient.query(
            'SELECT * FROM official_applications WHERE discord_id = $1',
            [discordId]
        );
        console.log(`Checked existing applications, found: ${existingApplication.rows.length}`);

        if (existingApplication.rows.length > 0) {
            await interaction.reply({
                content: 'You have already submitted an application. Please wait for it to be reviewed.',
                ephemeral: true,
            });
            await pgClient.end();
            return;
        }

        const officialRoleIds = ['1286098187223957617', '1286098139513880648', '1286098091396698134'];
        let member;
        try {
            member = await interaction.guild.members.fetch(discordId);
            console.log(`Fetched guild member: ${member.user.tag}`);
        } catch (error) {
            console.error(`Error fetching guild member:`, error);
            await interaction.reply({ content: 'Failed to fetch your member data.', ephemeral: true });
            await pgClient.end();
            return;
        }

        if (officialRoleIds.some(roleId => member.roles.cache.has(roleId))) {
            await interaction.reply({
                content: 'You already have an official role and cannot submit another application.',
                ephemeral: true,
            });
            await pgClient.end();
            return;
        }

        const sheetID = '116zau8gWkOizH9KCboH8Xg5SjKOHR_Lc_asfaYQfMdI';
        const sheetTabName = 'Application';
        const sheets = google.sheets({ version: 'v4', auth: authorize() });

        let agreedToRules, understandsConsequences, inGameUsername;
        try {
            agreedToRules = interaction.fields.getTextInputValue('agreement').toLowerCase() === 'yes';
            understandsConsequences = interaction.fields.getTextInputValue('banAwareness').toLowerCase() === 'yes';
            inGameUsername = interaction.fields.getTextInputValue('username');
            console.log(`Parsed user input: ${agreedToRules}, ${understandsConsequences}, ${inGameUsername}`);
        } catch (error) {
            console.error('Error parsing interaction fields:', error);
            await interaction.reply({ content: 'There was an issue processing your form submission.', ephemeral: true });
            await pgClient.end();
            return;
        }

        const now = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });
        const applicationsChannel = interaction.guild.channels.cache.get('1284290923819175976');
        if (!applicationsChannel) {
            console.error(`Channel with ID '1284290923819175976' not found.`);
            await interaction.reply({ content: 'There was an issue submitting your application.', ephemeral: true });
            await pgClient.end();
            return;
        }

        const applicationEmbed = new EmbedBuilder()
            .setTitle('New Official Application')
            .addFields(
                { name: 'Discord Username', value: member.user.tag, inline: true },
                { name: 'In-Game Username', value: inGameUsername || 'Not provided', inline: true },
                { name: 'Agreed to Rules', value: agreedToRules ? 'Yes' : 'No', inline: true },
                { name: 'Understands Consequences', value: understandsConsequences ? 'Yes' : 'No', inline: true }
            )
            .setTimestamp();

        const approveButton = new ButtonBuilder()
            .setCustomId(`approve_${discordId}`)
            .setLabel('Approve')
            .setStyle(ButtonStyle.Success);

        const rejectButton = new ButtonBuilder()
            .setCustomId(`reject_${discordId}`)
            .setLabel('Reject')
            .setStyle(ButtonStyle.Danger);

        const actionRow = new ActionRowBuilder().addComponents(approveButton, rejectButton);

        const applicationMessage = await applicationsChannel.send({ embeds: [applicationEmbed], components: [actionRow] });
        console.log(`Application message sent successfully with buttons`);

        const applicationUrl = applicationMessage.url;
        await pgClient.query(
            `INSERT INTO official_applications (discord_id, discord_username, in_game_username, agreed_to_rules, understands_consequences, application_url, submitted_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
            [discordId, member.user.tag, inGameUsername, agreedToRules, understandsConsequences, applicationUrl]
        );
        console.log(`Application logged to database`);

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

        await interaction.reply({ content: 'Thank you for submitting your application!', ephemeral: true });
        await pgClient.end();
        console.log(`Database connection closed`);
    } catch (error) {
        console.error('Unexpected error in handleOfficialsApplicationSubmission:', error);
    }
};

const handleLfgSystem1Create = async (interaction) => {
    await interaction.deferReply({ephemeral: true});

    const inGameUsername = interaction.fields.getTextInputValue('inGameUsernameSystem1');
    const description = interaction.fields.getTextInputValue('descriptionSystem1');
    const startTime = interaction.fields.getTextInputValue('startTimeSystem1');
    const place = interaction.fields.getTextInputValue('placeSystem1');

    const embed = new EmbedBuilder()
        .setTitle('Looking For Group')
        .setColor(0x00FF00)
        .setDescription('Find a group to play with! Join now!')
        .addFields(
            { name: 'In-Game Username', value: inGameUsername, inline: true },
            { name: 'Description', value: description, inline: true },
            { name: 'Start Time', value: startTime, inline: true },
            { name: 'Place of Gathering', value: place, inline: true },
        )
        .setFooter({ text: `Post by ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() })
        .setTimestamp();

    const joinGroupButton = new ButtonBuilder()
        .setCustomId('lfgSystem1Join')
        .setLabel('Join Group')
        .setStyle(ButtonStyle.Primary);

    const viewParticipantsButton = new ButtonBuilder()
        .setCustomId('lfgSystem1ViewParticipants')
        .setLabel('View Participants')
        .setStyle(ButtonStyle.Secondary);

    const closePostButton = new ButtonBuilder()
        .setCustomId('lfgSystem1Close')
        .setLabel('Close Post')
        .setStyle(ButtonStyle.Danger);

    const actionRow = new ActionRowBuilder().addComponents(joinGroupButton, viewParticipantsButton, closePostButton);

    const lfgChannel = interaction.guild.channels.cache.get('807771981222641664');
    const message = await lfgChannel.send({ embeds: [embed], components: [actionRow] });

    const threadName = `${inGameUsername}-LFG-Thread`;
    const thread = await lfgChannel.threads.create({
        name: threadName,
        autoArchiveDuration: 1440,
        type: 12,
        reason: 'LFG post thread',
    });

    await thread.members.add(interaction.user.id);
    await thread.send(`Welcome <@${interaction.user.id}>! Use this thread to manage your group and chat with members.`);

    const client = new Client(clientConfig);
    await client.connect();

    try {
        await client.query('INSERT INTO "lfg_data" ("post_owner_discord_id", "post_message_id", "discord_thread_id", "participants") VALUES ($1, $2, $3, $4)', [
            interaction.user.id,
            message.id,
            thread.id,
            [],
        ]);
    } finally {
        await client.end();
    }

    await interaction.editReply({content: 'Your LFG post has been created!'});
};

const handleGenerateTemplateModal = async (interaction) => {
    const type = interaction.customId.includes('kotc') ? 'kotc' : 'gc_officials';

    const inGameName = interaction.fields.getTextInputValue('ingamename');
    const gameMode = interaction.fields.getTextInputValue('gamemode');
    const courtName = interaction.fields.getTextInputValue('courtname');
    const ruleSet = type === 'gc_officials' ? interaction.fields.getTextInputValue('ruleset') : null;

    const initialEphemeralMessage = 'One moment while we generate your template! Once generated, hold down on the message, then press Copy Text to copy the contents to your clipboard, then paste it in https://discord.com/channels/752216589792706621/987233054915428422!';

    await interaction.reply({ content: initialEphemeralMessage, ephemeral: true });

    let templateMessage;
    if (type === 'kotc') {
        templateMessage = `Hey @KOTC Player I'm hosting a Friendly Fire KOTC Lobby right now!\n\nGame mode is hosted using the https://discord.com/channels/752216589792706621/1286079900196798515 Ruleset!\n\n## Here is how to join\n- Go to <#879142306932981800>\n- Use the /followplayer [${inGameName}] commands and follow ${inGameName}\n- Come join my in-game court with the name ${courtName}\n- Game Mode: ${gameMode}`;
    } else if (type === 'gc_officials') {
        templateMessage = `Hey @Looking for Games I’m hosting an officials lobby right now!\n\nGame modes are hosted using the ${ruleSet} Ruleset!\n\n## Here is how to join\n- Go to <#879142306932981800>\n- Use the /followplayer [${inGameName}] commands and follow ${inGameName}\n- Come join my in-game court with the name ${courtName}\n- Game Mode: ${gameMode}`;
    }

    setTimeout(async () => {
        try {
            await interaction.editReply({ content: 'Your template was generated!' });
            await interaction.user.send(templateMessage);
            await interaction.editReply({ content: 'Your template was generated and sent to your DMs!' });
        } catch (error) {
            console.error(`Failed to send DM to ${interaction.user.tag}: ${error.message}`);
            await interaction.editReply({ content: 'Your template was generated, but I could not send it to your DMs. Please ensure your DMs are open and try again!' });
        }
    }, 8500);
};

const handleInviteButton = async (interaction, action) => {
    const mascotSquads_local = [
        { name: "Duck Squad", roleId: "1359614680615620608" },
        { name: "Pumpkin Squad", roleId: "1361466564292907060" },
        { name: "Snowman Squad", roleId: "1361466801443180584" },
        { name: "Gorilla Squad", roleId: "1361466637261471961" },
        { name: "Bee Squad", roleId: "1361466746149666956" },
        { name: "Alligator Squad", roleId: "1361466697059664043" },
    ];
    const SL_ID = 1;
    const SL_SQUAD_NAME = 2;
    const SL_EVENT_SQUAD = 3;
    const AD_ID = 1;
    const AD_PREFERENCE = 7;

    try {
        await interaction.deferReply({ ephemeral: true });

        let inviteData;
        try {
            inviteData = await fetchInviteById(interaction.message.id)
            if (!inviteData) throw new Error('404')
        } catch (apiError) {
            if (apiError.message === '404') { await interaction.editReply({ content: 'This invite seems to have expired or is invalid.' }) }
            else { console.error('Error fetching invite data:', apiError.message); await interaction.editReply({ content: 'Could not verify the invite status.' }) }
            return;
        }
        if (!inviteData) { await interaction.editReply({ content: 'The invite is no longer available.' }); return; }

        const { squad_name: squadName, tracking_message_id: trackingMessageId, command_user_id: commandUserID, invited_member_id: invitedMemberId, squad_type: squadType, invite_status: currentInviteStatus } = inviteData;

        if (currentInviteStatus === 'Accepted' || currentInviteStatus === 'Rejected' || currentInviteStatus === 'Squad Full') {
            await interaction.editReply({ content: `This invite has already been processed (${currentInviteStatus}).`}); return;
        }
        if (interaction.user.id !== invitedMemberId) {
            await interaction.editReply({ content: 'You cannot interact with an invite meant for someone else.'}); return;
        }

        const gymClassGuild = await interaction.client.guilds.fetch('752216589792706621').catch(() => null);
        const ballheadGuild = await interaction.client.guilds.fetch('1233740086839869501').catch(() => null);
        const guild = interaction.guild && (interaction.guild.id === '752216589792706621' || interaction.guild.id === '1233740086839869501') ? interaction.guild : (gymClassGuild || ballheadGuild);
        if (!guild) {
            console.error('Could not fetch required Guilds.'); await interaction.editReply({ content: 'Could not find the necessary server.' }); return;
        }
        let trackingChannel;
        if (ballheadGuild) { trackingChannel = ballheadGuild.channels.cache.get('1233853415952748645') || await ballheadGuild.channels.fetch('1233853415952748645').catch(err => { console.error(`Failed to fetch tracking channel: ${err.message}`); return null; }); }
        let trackingMessage;
        if (trackingChannel && trackingMessageId) { trackingMessage = await trackingChannel.messages.fetch(trackingMessageId).catch(err => { console.warn(`Failed to fetch tracking message ${trackingMessageId}: ${err.message}`); return null; }); }
        const commandUser = await interaction.client.users.fetch(commandUserID).catch(err => { console.error(`Failed to fetch command user ${commandUserID}: ${err.message}`); return null; });
        if (!commandUser) { await interaction.editReply({ content: 'Could not find the user who sent the invite.' }); return; }
        const inviteMessageChannel = interaction.channel || await interaction.client.channels.fetch(interaction.channelId).catch(err => { console.error(`Failed to fetch invite message channel ${interaction.channelId}: ${err.message}`); return null; });
        if (!inviteMessageChannel) { await interaction.editReply({ content: 'Failed to find the channel where the invite was sent.' }); return; }
        const inviteMessage = await inviteMessageChannel.messages.fetch(interaction.message.id).catch(err => { console.error(`Failed to fetch invite message ${interaction.message.id}: ${err.message}`); return null; });
        if (!inviteMessage) { await interaction.editReply({ content: 'Failed to find the original invite message.' }); return; }


        if (action === 'accept') {
            const member = await guild.members.fetch(invitedMemberId).catch(() => null);
            if (!member) { await interaction.editReply({ content: 'You could not be found in the server.' }); return; }

            const sheetsAuthClient = new google.auth.JWT(
                credentials.client_email, null, credentials.private_key, ['https://www.googleapis.com/auth/spreadsheets']
            );
            const sheets = google.sheets({ version: 'v4', auth: sheetsAuthClient });

            const [squadMembersResponse, allDataResponse, squadLeadersResponse] = await Promise.all([
                sheets.spreadsheets.values.get({ spreadsheetId: '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k', range: 'Squad Members!A:E' }),
                sheets.spreadsheets.values.get({ spreadsheetId: '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k', range: 'All Data!A:H' }),
                sheets.spreadsheets.values.get({ spreadsheetId: '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k', range: 'Squad Leaders!A:F' })
            ]).catch(err => { throw new Error("Failed to retrieve sheet data for processing invite.") });

            const squadMembersData = (squadMembersResponse.data.values || []).slice(1);
            const allData = (allDataResponse.data.values || []);
            const allDataHeaderless = allData.slice(1);
            const squadLeadersData = (squadLeadersResponse.data.values || []).slice(1);

            const membersInSquad = squadMembersData.filter(row => row && row.length > 2 && row[2]?.trim() === squadName);
            const currentMemberCount = membersInSquad.length + 1;
            const max_members_local = 10;
            if (currentMemberCount >= max_members_local) {
                await interaction.editReply({ content: `Cannot accept: Squad **${squadName}** is full (${currentMemberCount}/${max_members_local}).`, ephemeral: true });
                if (trackingMessage) await trackingMessage.edit(`Invite from <@${commandUserID}> to <@${invitedMemberId}> for squad **${squadName}** failed: Squad Full.`).catch(console.error);
                try { await updateInviteStatus(interaction.message.id, 'Squad Full') } catch (apiError) { console.error("API Error updating invite status to 'Squad Full':", apiError.message) }
                const components = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`invite_accept_${interaction.message.id}`).setLabel('Accept Invite').setStyle(ButtonStyle.Success).setDisabled(true),
                    new ButtonBuilder().setCustomId(`invite_reject_${interaction.message.id}`).setLabel('Reject Invite').setStyle(ButtonStyle.Danger).setDisabled(true)
                );
                const squadFullEmbed = new EmbedBuilder(inviteMessage.embeds[0]?.data || {}).setTitle('Squad Full').setDescription(`Squad **${squadName}** is full (${currentMemberCount}/${max_members_local}).`).setColor(0xff0000);
                await inviteMessage.edit({ embeds: [squadFullEmbed], components: [components] }).catch(console.error);
                return;
            }

            await interaction.editReply({ content: `You have accepted the invite to join **${squadName}** (${squadType})!` });
            if (trackingMessage) await trackingMessage.edit(`<@${member.id}> accepted invite from <@${commandUserID}> to join **${squadName}** (${squadType}).`).catch(console.error);
            try { await updateInviteStatus(interaction.message.id, 'Accepted') } catch (apiError) { console.error("API Error updating invite status to 'Accepted':", apiError.message) }

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
                if (mascotInfo) { try { const roleToAdd = await guild.roles.fetch(mascotInfo.roleId); if (roleToAdd) { await member.roles.add(roleToAdd); assignedMascotRoleName = roleToAdd.name; console.log(`Added mascot role '${assignedMascotRoleName}' to ${member.user.tag}`); } else { console.warn(`Mascot role ID ${mascotInfo.roleId} (${mascotInfo.name}) not found.`); await interaction.followUp({ content: `Warning: Joined squad, but couldn't find mascot role (${mascotInfo.name}).`, ephemeral: true }).catch(()=>{}); } } catch (roleError) { console.error(`Failed to add mascot role ${mascotInfo.name}: ${roleError.message}`); await interaction.followUp({ content: `Warning: Joined squad, but couldn't assign mascot role (${mascotInfo.name}).`, ephemeral: true }).catch(()=>{}); } } else { console.warn(`No role mapping for event squad: ${eventSquadNameToAssign}`); }
            }

            const acceptanceEmbed = new EmbedBuilder(inviteMessage.embeds[0]?.data || {}).setTitle('Invite Accepted!').setDescription(`**${member.user.username}** has accepted the invite to join **${squadName}**!`).setColor(0x00ff00);
            const acceptedComponents = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`invite_accept_${interaction.message.id}`).setLabel('Accepted').setStyle(ButtonStyle.Success).setDisabled(true),
                new ButtonBuilder().setCustomId(`invite_reject_${interaction.message.id}`).setLabel('Reject Invite').setStyle(ButtonStyle.Danger).setDisabled(true)
            );
            await inviteMessage.edit({ embeds: [acceptanceEmbed], components: [acceptedComponents] }).catch(console.error);

            let inviterDmDescription = `Your invite to **${member.user.username}** for squad **${squadName}** has been accepted!`;
            if (assignedMascotRoleName) { inviterDmDescription += `\nThey were assigned the **${assignedMascotRoleName}** role.` }
            const dmEmbed = new EmbedBuilder().setTitle('Invite Accepted').setDescription(inviterDmDescription).setColor(0x00ff00);
            await commandUser.send({ embeds: [dmEmbed] }).catch(err => { console.log(`Failed to DM command user ${commandUserID}: ${err.message}`); });

            try { await deleteInvite(interaction.message.id) } catch (apiError) { console.error("API Error deleting invite:", apiError.message) }

        } else if (action === 'reject') {
            await interaction.editReply({ content: 'You have rejected the invite.', ephemeral: true });
            if (trackingMessage) await trackingMessage.edit(`<@${invitedMemberId}> rejected invite from <@${commandUserID}> for **${squadName}**.`).catch(console.error);
            try { await updateInviteStatus(interaction.message.id, 'Rejected') } catch (apiError) { console.error("API Error updating status to 'Rejected':", apiError.message) }
            const rejectionEmbed = new EmbedBuilder(inviteMessage.embeds[0]?.data || {}).setTitle('Invite Rejected').setDescription(`Invite rejected by ${interaction.user.username}.`).setColor(0xff0000);
            const rejectedComponents = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`invite_accept_${interaction.message.id}`).setLabel('Accept Invite').setStyle(ButtonStyle.Success).setDisabled(true),
                new ButtonBuilder().setCustomId(`invite_reject_${interaction.message.id}`).setLabel('Rejected').setStyle(ButtonStyle.Danger).setDisabled(true)
            );
            await inviteMessage.edit({ embeds: [rejectionEmbed], components: [rejectedComponents] }).catch(console.error);
            const dmEmbed = new EmbedBuilder().setTitle('Invite Rejected').setDescription(`Your invite to **${interaction.user.username}** for **${squadName}** was rejected.`).setColor(0xff0000);
            await commandUser.send({ embeds: [dmEmbed] }).catch(err => { console.log(`Failed to DM command user about rejection: ${err.message}`); });
            try { await deleteInvite(interaction.message.id) } catch (apiError) { console.error("API Error deleting rejected invite:", apiError.message) }
        } else {
            await interaction.editReply({ content: 'Unknown action specified.', ephemeral: true });
        }

    } catch (error) {
        console.error('Error handling invite button interaction:', error);
        await interaction.editReply({ content: 'An error occurred while processing the invite interaction.', ephemeral: true }).catch(console.error);
        try {
            const client = interaction.client; if (!client) return;
            const errorGuild = await client.guilds.fetch('1233740086839869501').catch(() => null); if (!errorGuild) return;
            const errorChannel = await errorGuild.channels.fetch('1233853458092658749').catch(() => null); if (!errorChannel) return;
            const errorEmbed = new EmbedBuilder().setTitle('Invite Button Interaction Error').setDescription(`**User:** ${interaction.user.tag} (${interaction.user.id})\n**Action:** ${action}\n**Msg ID:** ${interaction.message.id}\n**Error:** ${error.message}`).setColor(0xff0000).setTimestamp();
            await errorChannel.send({ embeds: [errorEmbed] });
        } catch (logError) { console.error('Failed to log button interaction error:', logError); }
    }
};

const handleApplicationButton = async (interaction, action, client) => {
    try {
        await interaction.deferReply({ ephemeral: true });

        const messageUrl = interaction.message.url;

        let applicationData;
        try {
            applicationData = await fetchSquadApplicationByMessageUrl(messageUrl);

            if (!applicationData) {
                throw new Error(`No application data found in API for URL: ${messageUrl}`);
            }
            if (applicationData.status && applicationData.status !== 'Pending') {
                await interaction.editReply({ content: `This application has already been ${applicationData.status.toLowerCase()}.`, ephemeral: true });
                return;
            }
            if (typeof applicationData.member_object === 'string') {
                applicationData.member_object_parsed = JSON.parse(applicationData.member_object);
            } else if (typeof applicationData.member_object === 'object' && applicationData.member_object !== null) {
                applicationData.member_object_parsed = applicationData.member_object;
            } else {
                throw new Error('Invalid or missing member_object in API data.');
            }

        } catch (apiError) {
            console.error('Error fetching or parsing application data:', apiError);
            await interaction.editReply({ content: 'Could not retrieve application details. It might have expired or there was an API error.', ephemeral: true });
            return;
        }

        const { user_id: applicantUserId, member_squad_name: squadName, squad_type: squadType } = applicationData;
        const memberObject = applicationData.member_object_parsed;
        const applicantUsername = memberObject.username || 'Unknown User';


        const user = await client.users.fetch(applicantUserId).catch(err => {
            console.error(`Failed to fetch applicant user ${applicantUserId}: ${err.message}`);
            return null;
        });
        if (!user) {
            await interaction.editReply({ content: `Could not fetch the applicant's user profile (${applicantUserId}). They may no longer be on Discord.`, ephemeral: true });
            return;
        }

        const guild = client.guilds.cache.get(interaction.guildId) || await client.guilds.fetch(interaction.guildId).catch(() => null);
        if (!guild) {
            await interaction.editReply({ content: 'Could not fetch the server information.', ephemeral: true });
            return;
        }
        const member = await guild.members.fetch(applicantUserId).catch(() => null);
        if (!member) {
            await interaction.editReply({ content: `Could not find the applicant (<@${applicantUserId}>) as a member of this server.`, ephemeral: true });

            return;
        }

        const squadLeaderRole = guild.roles.cache.get('1218468103382499400');
        const competitiveRole = guild.roles.cache.get('1288918946258489354');
        const contentRole = guild.roles.cache.get('1290803054140199003');
        if (!squadLeaderRole || !competitiveRole || !contentRole) {
            console.error("One or more required leader roles not found!");
            await interaction.editReply({ content: 'Configuration error: Cannot find required roles.', ephemeral: true });
            return;
        }


        const auth = authorize();
        const sheets = google.sheets({ version: 'v4', auth });

        let isAlreadyLeader = false;
        if (action === 'accept') {
            try {
                const squadLeadersResponse = await sheets.spreadsheets.values.get({
                    spreadsheetId: `1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k`,
                    range: 'Squad Leaders!A:F'
                });
                const squadLeaders = (squadLeadersResponse.data.values || []).slice(1);
                isAlreadyLeader = squadLeaders.some(row => row && row.length > 1 && row[1] === applicantUserId);
            } catch (sheetError) {
                console.error("Error checking Squad Leaders sheet:", sheetError);
                throw new Error("Failed to check existing squad leaders.");
            }
        }


        if (action === 'accept') {
            if (isAlreadyLeader) {
                await user.send({
                    embeds: [new EmbedBuilder().setTitle('Squad Registration Denied').setDescription('We noticed you submitted multiple applications. This one has been denied as you already own a squad.').setColor(0xFF0000)]
                }).catch(() => console.log(`Failed to send 'already leader' denial DM to ${applicantUsername}`));

                const denialEmbed = new EmbedBuilder()
                    .setTitle('Squad Registration Denied (Already Leader)')
                    .setDescription(`**${applicantUsername}**'s application for **${squadName}** was automatically denied because they already own a squad.`)
                    .setColor(0xFF0000);
                await interaction.message.edit({ embeds: [denialEmbed], components: [] }).catch(console.error);

                await updateApplicationStatus(sheets, messageUrl, 'Denied', applicantUsername, applicantUserId, squadName, squadType);
                await deleteApplicationDataByMessageUrl(messageUrl);

                await interaction.editReply({ content: 'This user already owns a squad. The application has been automatically denied.', ephemeral: true });
                return;
            }

            let currentDate = new Date();
            let dateString = `${(currentDate.getMonth() + 1).toString().padStart(2, '0')}/${currentDate.getDate().toString().padStart(2, '0')}/${currentDate.getFullYear().toString().slice(-2)}`;

            const newLeaderRow = [
                applicantUsername,
                applicantUserId,
                squadName,
                'N/A',
                'FALSE',
                dateString
            ];
            await sheets.spreadsheets.values.append({
                spreadsheetId: `1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k`,
                range: 'Squad Leaders!A1',
                valueInputOption: 'RAW',
                resource: { values: [newLeaderRow] }
            }).catch(err => { throw new Error(`Failed to append to Squad Leaders sheet: ${err.message}`); });


            const allDataResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: `1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k`,
                range: 'All Data!A:H'
            });
            const allData = allDataResponse.data.values || [];
            let userInAllDataIndex = -1;
            const allDataHeaderless = allData.slice(1);
            userInAllDataIndex = allDataHeaderless.findIndex(row => row && row.length > 1 && row[1] === applicantUserId);

            if (userInAllDataIndex !== -1) {
                const sheetRowIndex = userInAllDataIndex + 2;
                const valuesToUpdate = [
                    squadName,
                    squadType || 'N/A',
                    'N/A',
                    'FALSE',
                    'Yes'
                ];
                await sheets.spreadsheets.values.update({
                    spreadsheetId: `1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k`,
                    range: `All Data!C${sheetRowIndex}:G${sheetRowIndex}`,
                    valueInputOption: 'RAW',
                    resource: { values: [valuesToUpdate] }
                }).catch(err => { throw new Error(`Failed to update All Data sheet: ${err.message}`); });

            } else {
                const newAllDataRow = [
                    applicantUsername,
                    applicantUserId,
                    squadName,
                    squadType || 'N/A',
                    'N/A',
                    'FALSE',
                    'Yes',
                    'TRUE'
                ];
                await sheets.spreadsheets.values.append({
                    spreadsheetId: `1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k`,
                    range: 'All Data!A1',
                    valueInputOption: 'RAW',
                    resource: { values: [newAllDataRow] }
                }).catch(err => { throw new Error(`Failed to append to All Data sheet: ${err.message}`); });
            }

            try {
                await member.roles.add(squadLeaderRole);
                if (squadType === 'Competitive') await member.roles.add(competitiveRole);
                if (squadType === 'Content') await member.roles.add(contentRole);
            } catch (roleError) {
                console.warn(`Failed to add roles to ${applicantUsername} (${applicantUserId}): ${roleError.message}`);
                await interaction.followUp({ content: `Warning: Could not add all required roles to ${member.user.tag}. Please check permissions and assign manually.`, ephemeral: true });
            }

            try {
                await member.setNickname(`[${squadName}] ${applicantUsername}`);
            } catch (nickError) {
                if (nickError.code === 50013) {
                    console.warn(`Missing permissions to set nickname for ${applicantUsername}`);
                    await interaction.followUp({ content: `Warning: Could not set nickname for ${member.user.tag} due to permissions.`, ephemeral: true });
                } else {
                    console.warn(`Failed to set nickname for ${applicantUsername}: ${nickError.message}`);
                }
            }

            try {
                await user.send({
                    embeds: [new EmbedBuilder().setTitle('Squad Registration Accepted!').setDescription(`Your application for squad **${squadName}** (${squadType || 'N/A'}) has been accepted!`).setColor(0x00FF00)]
                });
            } catch (dmError) {
                console.warn(`Failed to send acceptance DM to ${applicantUsername}: ${dmError.message}`);
                await interaction.followUp({ content: `Accepted application for ${member.user.tag}, but could not send them a DM notification.`, ephemeral: true });
            }

            const acceptanceEmbed = new EmbedBuilder()
                .setTitle('Squad Registration Accepted')
                .setDescription(`**${applicantUsername}**'s application for **${squadName}** (${squadType || 'N/A'}) was accepted by <@${interaction.user.id}>.`)
                .setColor(0x00FF00)
                .setTimestamp();
            await interaction.message.edit({ embeds: [acceptanceEmbed], components: [] }).catch(console.error);

            await updateApplicationStatus(sheets, messageUrl, 'Accepted', applicantUsername, applicantUserId, squadName, squadType);
            await deleteApplicationDataByMessageUrl(messageUrl);

            await interaction.editReply({ content: '✅ Squad registration accepted and processed.', ephemeral: true });

        } else if (action === 'deny') {
            const genericDenyReason = "Your squad registration application was not approved at this time. You may re-apply later if circumstances change.";

            await user.send({
                embeds: [new EmbedBuilder().setTitle('Squad Registration Denied').setDescription(genericDenyReason).setColor(0xFF0000)]
            }).catch(() => console.log(`Failed to send denial DM to ${applicantUsername}`));

            const denialEmbed = new EmbedBuilder()
                .setTitle('Squad Registration Denied')
                .setDescription(`**${applicantUsername}**'s application for **${squadName}** was denied by <@${interaction.user.id}>.`)
                .setColor(0xFF0000)
                .setTimestamp();
            await interaction.message.edit({ embeds: [denialEmbed], components: [] }).catch(console.error);

            await updateApplicationStatus(sheets, messageUrl, 'Denied', applicantUsername, applicantUserId, squadName, squadType);
            await deleteApplicationDataByMessageUrl(messageUrl);

            await interaction.editReply({ content: '❌ Squad registration denied.', ephemeral: true });
        }

    } catch (error) {
        console.error('Error in handleApplicationButton:', error);
        try {
            const errorGuild = await client.guilds.fetch(LOGGING_GUILD_ID);
            const errorChannel = await errorGuild.channels.fetch(ERROR_LOGGING_CHANNEL_ID);
            const errorEmbed = new EmbedBuilder()
                .setTitle('Application Button Error')
                .setDescription(`**Button:** ${interaction.customId}\n**User:** ${interaction.user.tag} (${interaction.user.id})\n**Error:** ${error.message}`)
                .setColor(0xFF0000)
                .setTimestamp();
            await errorChannel.send({ embeds: [errorEmbed] });
        } catch (logError) {
            console.error('Failed to log application button error:', logError);
        }
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: `An error occurred: ${error.message || 'Please try again.'}`, ephemeral: true }).catch(console.error);
        } else {
            await interaction.editReply({ content: `An error occurred: ${error.message || 'Please try again.'}`, ephemeral: true }).catch(console.error);
        }
    }
};


const updateApplicationStatus = async (sheets, applicationMessageUrl, status, memberName, memberId, squadName, squadType) => {
    try {
        const applicationsResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: `1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k`,
            range: 'Applications!A:F'
        });

        const applications = applicationsResponse.data.values || [];
        let applicationIndex = -1;
        const headerlessApplications = applications.slice(1);
        applicationIndex = headerlessApplications.findIndex(row => row && row.length > 4 && row[4] === applicationMessageUrl);

        if (applicationIndex !== -1) {
            const sheetRowIndex = applicationIndex + 2;
            await sheets.spreadsheets.values.update({
                spreadsheetId: `1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k`,
                range: `Applications!F${sheetRowIndex}`,
                valueInputOption: 'RAW',
                resource: { values: [[status]] }
            });
            console.log(`Updated application status to ${status} for URL ${applicationMessageUrl}`);
        } else {
            console.error(`Could not find application row with URL ${applicationMessageUrl} to update status to ${status}.`);
        }
    } catch (error) {
        console.error('Error updating application status in sheet:', error.message);
    }
};


const deleteApplicationDataByMessageUrl = async (applicationMessageUrl) => {
    try {
        const app = await fetchSquadApplicationByMessageUrl(applicationMessageUrl)
        if (!app) return null
        const result = await deleteSquadApplicationById(app.id)
        return result
    } catch (error) {
        console.error('Error deleting application data:', error.message);
        return null;
    }
};

const handlePagination1 = async (customId, interaction) => {
    try {
        await interaction.deferUpdate();
        console.log(`[Pagination] Received ${customId} on interaction ${interaction.id}`);

        const customId = interaction.customId;
        const originalInteractionId = interaction.message.interaction?.id;
        console.log(`[Pagination] originalInteractionId=${originalInteractionId}`);

        if (!originalInteractionId) {
            console.error("Could not retrieve original interaction ID from message.");
            return;
        }

        const commandState = interaction.client.squadsPagination.get(originalInteractionId);        console.log(`[Pagination] commandState for ${originalInteractionId}:`, commandState);

        if (!commandState) {
            console.error(`No commandData found for original interaction ID: ${originalInteractionId}`);
            await interaction.editReply({ content: "Sorry, I can't find the data for this list anymore. Please run the command again.", embeds: [], components: [] });
            return;
        }

        const { squadList, totalPages, currentPage } = commandState;
        let newPage = currentPage;

        if (customId === 'squads_next') {
            newPage = currentPage + 1;
        } else if (customId === 'squads_prev') {
            newPage = currentPage - 1;
        } else {
            console.warn(`Received unexpected customId in handlePagination1: ${customId}`);
            return;
        }

        if (newPage < 1 || newPage > totalPages) {
            console.warn(`Pagination attempt outside bounds: newPage=${newPage}, totalPages=${totalPages}`);
            return;
        }

        interaction.client.squadsPagination.get(originalInteractionId).currentPage = newPage;

        const generateEmbed = (page) => {
            const start = (page - 1) * ITEMS_PER_PAGE;
            const end = start + ITEMS_PER_PAGE;
            const pageItems = squadList.slice(start, Math.min(end, squadList.length));
            return new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('List of Squads')
                .setDescription(pageItems.length > 0 ? pageItems.join('\n') : 'No squads on this page.')
                .setFooter({ text: `Page ${page} of ${totalPages}` })
                .setTimestamp();
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
        }

        await interaction.editReply({ embeds: [generateEmbed(newPage)], components: [generateButtons(newPage)] });

    } catch (error) {
        console.error('Error handling pagination:', error);

        try {
            if (!interaction.client) throw new Error("Interaction client is not available.");

            const errorGuild = await interaction.client.guilds.fetch(BALLHEAD_GUILD_ID).catch(() => null);
            if (!errorGuild) throw new Error(`Could not fetch error guild: ${BALLHEAD_GUILD_ID}`);

            const errorChannel = await errorGuild.channels.fetch(BOT_BUGS_CHANNEL_ID).catch(() => null);
            if (!errorChannel) throw new Error(`Could not fetch error channel: ${BOT_BUGS_CHANNEL_ID}`);

            const errorEmbed = new EmbedBuilder()
                .setTitle('Pagination Error')
                .setDescription(`An error occurred while processing pagination:\n**Error:** ${error.message}\n**Interaction Custom ID:** ${interaction.customId}\n**Original Command ID:** ${interaction.message.interaction?.id}`)
                .setColor(0xFF0000)
                .setTimestamp();
            await errorChannel.send({ embeds: [errorEmbed] });
        } catch (logError) {
            console.error('Failed to log pagination error:', logError);
        }

        try {
            await interaction.followUp({
                content: 'An error occurred while changing pages. Please try running the command again.',
                ephemeral: true
            });
        } catch (followUpError) {
            console.error("Failed to send follow-up error message:", followUpError);
        }
    }
};

async function getSquadData(squadName) {
    const auth = authorize();
    const sheets = google.sheets({ version: 'v4', auth });
    const normalizedSquadName = squadName.toUpperCase();

    async function fetchFilteredRows(range, filterCondition) {
        try {
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k',
                range: range,
            });
            const allRows = response.data.values || [];
            const dataRows = allRows.slice(1);
            return dataRows.filter(filterCondition);
        } catch (error) {
            console.error(`Error fetching data from Sheets range ${range}:`, error);
            throw new Error(`Failed to fetch data for range ${range}.`);
        }
    }

    try {
        const leaderFilter = row => row && row.length > 2 && row[2]?.toUpperCase() === normalizedSquadName;
        const matchingLeaders = await fetchFilteredRows('Squad Leaders!A:F', leaderFilter);

        if (matchingLeaders.length === 0) {
            throw new Error(`No squad found with the name "${squadName}".`);
        }
        if (matchingLeaders.length > 1) {
            console.warn(`Multiple leaders found for squad "${squadName}". Using the first one found.`);
        }
        const leaderRow = matchingLeaders[0];
        const leaderId = leaderRow[1]?.trim();
        const formattedLeader = leaderId ? `<@${leaderId}>` : 'Leader ID Not Found';

        const memberFilter = row => row && row.length > 2 && row[2]?.toUpperCase() === normalizedSquadName;
        const matchingMembers = await fetchFilteredRows('Squad Members!A:E', memberFilter);

        let formattedMembers = 'No members found.';
        if (matchingMembers.length > 0) {
            formattedMembers = matchingMembers
                .map(row => row[1]?.trim())
                .filter(id => id)
                .map(id => `- <@${id}>`)
                .join('\n');
            if (!formattedMembers) formattedMembers = 'No valid member IDs found.';
        }

        return {
            squadMembers: formattedMembers,
            squadLeader: formattedLeader
        };

    } catch (error) {
        console.error(`Error in getSquadData for "${squadName}": ${error.message}`);
        throw error;
    }
}

const hanldeviewRoster = async (interaction) => {
    let squadName;
    try {
        squadName = interaction.message.embeds[0]?.description?.match(/squad \*\*(.*?)\*\*/)?.[1];
        if (!squadName) {
            throw new Error("Could not extract squad name from the message embed.");
        }
    } catch (e) {
        console.error("Error extracting squad name:", e);
        await interaction.reply({ content: "Could not determine the squad name from the original message.", ephemeral: true });
        return;
    }


    try {
        const { squadMembers, squadLeader } = await getSquadData(squadName);
        await interaction.reply({
            ephemeral: true,
            embeds: [{
                color: 0x0099ff,
                title: `Roster for ${squadName}`,
                fields: [
                    { name: 'Squad Leader', value: squadLeader || 'Not specified' },
                    { name: 'Squad Members', value: squadMembers || 'None' },
                ],
                timestamp: new Date().toISOString()
            }],
        });
    } catch (error) {
        console.error(`Error fetching roster for ${squadName}:`, error);
        await interaction.reply({
            content: `Error fetching roster: ${error.message || 'Please try again later.'}`,
            ephemeral: true
        });
    }
}



const handleLfgSystem2Join = async (interaction) => {
    const pgClient = new Client(clientConfig);
    await pgClient.connect();

    try {
        const result = await pgClient.query('SELECT post_owner_discord_id, participants, discord_thread_id FROM lfm_data WHERE post_message_id = $1', [interaction.message.id]);

        if (result.rows.length === 0) {
            return interaction.reply({ content: 'Could not find the LFG post in the database.', ephemeral: true });
        }

        const { post_owner_discord_id: postOwnerId, participants: currentParticipants, discord_thread_id: threadId } = result.rows[0];

        if (interaction.user.id === postOwnerId) {
            return interaction.reply({ content: 'You cannot join your own group.', ephemeral: true });
        }

        if (currentParticipants.includes(interaction.user.id)) {
            return interaction.reply({ content: 'You have already joined this group.', ephemeral: true });
        }

        currentParticipants.push(interaction.user.id);
        await pgClient.query('UPDATE lfm_data SET participants = $1 WHERE post_message_id = $2', [
            currentParticipants,
            interaction.message.id,
        ]);

        const recruitmentChannel = interaction.guild.channels.cache.get(interaction.channelId);
        const thread = await recruitmentChannel.threads.fetch(threadId);

        if (!thread) {
            return interaction.reply({ content: 'The recruitment thread could not be found.', ephemeral: true });
        }

        await thread.members.add(interaction.user.id);
        await thread.send(`Welcome <@${interaction.user.id}>! <@${postOwnerId}>, a new member has joined your recruitment thread.`);

        await interaction.reply({ content: 'You have successfully joined the group!', ephemeral: true });
    } catch (error) {
        console.error('Error joining the group.', error);
        await interaction.reply({ content: 'An error occurred while trying to join the group.', ephemeral: true });
    } finally {
        await pgClient.end();
    }
};

const handleLfgSystem2Close = async (interaction) => {
    const pgClient = new Client(clientConfig);
    await pgClient.connect();

    try {
        const postMessageId = interaction.message.id;
        const userId = interaction.user.id;

        const result = await pgClient.query('SELECT post_owner_discord_id, discord_thread_id FROM lfm_data WHERE post_message_id = $1', [postMessageId]);

        if (!result || result.rows.length === 0) {
            return interaction.reply({ content: 'LFG post not found.', ephemeral: true });
        }

        const { post_owner_discord_id: postOwnerId, discord_thread_id: threadId } = result.rows[0];

        if (userId !== postOwnerId) {
            return interaction.reply({ content: 'Only the post owner can close this LFG post.', ephemeral: true });
        }

        const thread = interaction.guild.channels.cache.get(threadId);
        if (thread) {
            await thread.delete('LFG post closed by owner.');
        }

        await interaction.message.delete();
        await pgClient.query('DELETE FROM lfm_data WHERE post_message_id = $1', [postMessageId]);

        await interaction.reply({ content: 'Your LFG post has been closed!', ephemeral: true });
    } catch (error) {
        console.error('Error closing LFG post for System 2:', error);
        await interaction.reply({ content: 'An error occurred while closing the LFG post.', ephemeral: true });
    } finally {
        await pgClient.end();
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

        const messageContent = `Hey! Your application for officials has been approved and you now have the Official Prospect Role! If you're unsure what to do, press the "Help" button below!`;

        try {
            await user.send({
                content: messageContent,
                components: [row],
            });
        } catch (dmError) {
            console.error('Failed to send DM to user:', dmError.message);
        }


        const sheets = google.sheets({ version: 'v4', auth: authorize() });
        const applicationUrl = interaction.message.url;
        console.log(`Application URL : ${applicationUrl}`);
        await updateOfficialApplicationStatus(sheets, applicationUrl, 'Approved');

        const pgClient = new Client(clientConfig);
        await pgClient.connect();
        await pgClient.query(
            `DELETE FROM official_applications WHERE discord_id = $1`,
            [userId]
        );
        await pgClient.end();

        const approvedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setDescription('This application has been approved.')
            .setColor(0x00FF00);

        await interaction.message.edit({
            content: 'The application has been approved!',
            embeds: [approvedEmbed],
            components: [],
        });

        await interaction.editReply({
            content: 'The application has been successfully approved!',
            ephemeral: true,
        });

        const officialRole = interaction.guild.roles.cache.get(roleId);
        await user.roles.add(officialRole);

    } catch (error) {
        console.error('Error approving application:', error);

        if (!interaction.replied) {
            await interaction.editReply({
                content: 'There was an error while approving the application. Please try again later.',
                ephemeral: true,
            });
        }
    }
};

const updateOfficialApplicationStatus = async (sheets, applicationUrl, newStatus) => {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: '116zau8gWkOizH9KCboH8Xg5SjKOHR_Lc_asfaYQfMdI',
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

        const updateRange = `Application!F${rowIndex + 1}`;
        await sheets.spreadsheets.values.update({
            spreadsheetId: '116zau8gWkOizH9KCboH8Xg5SjKOHR_Lc_asfaYQfMdI',
            range: updateRange,
            valueInputOption: 'RAW',
            resource: {
                values: [[newStatus]],
            },
        });

        console.log(`Official application status updated to "${newStatus}" in Google Sheets.`);
    } catch (error) {
        console.error('Error updating official application status:', error);
        throw new Error(`Failed to update official application status: ${error.message}`);
    }
};

const handleQnAInteraction = async (interaction) => {
    const qaEmbed = new EmbedBuilder()
        .setTitle('Officials Program Q&A')
        .setDescription(`
            **Q: What videos do I have to submit?**
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
            
            If you're still confused, feel free to read-up on the [documentation](https://docs.google.com/document/d/1to-7k3EoB-bnBbzKS5zRggWLDKB8ApyLIib_a_te8TI/edit?usp=sharing).
        `)
        .setColor(0x00FF00);

    await interaction.reply({
        embeds: [qaEmbed],
        ephemeral: true,
    });
};

const handleOfficialsApplicationReject = async (interaction) => {
    try {
        await interaction.deferReply({ ephemeral: true });

        const userId = interaction.customId.split('_')[1];
        const user = await interaction.guild.members.fetch(userId);

        const nextStepsButton = new ButtonBuilder()
            .setCustomId(`officialsQnaReject`)
            .setLabel('Help!')
            .setStyle(ButtonStyle.Primary);

        const actionRow = new ActionRowBuilder().addComponents(nextStepsButton);

        const messageContent = `
            Unfortunately, your application for officials has been rejected. If you're confused on why, use the "Help!" button below.
        `;

        try {
            await user.send({
                content: messageContent,
                components: [actionRow],
            });
        } catch (dmError) {
            console.error('Failed to send DM to user:', dmError.message);
        }

        const sheets = google.sheets({ version: 'v4', auth: authorize() });
        const applicationUrl = interaction.message.url;
        await updateOfficialApplicationStatus(sheets, applicationUrl, 'Rejected');

        const pgClient = new Client(clientConfig);
        await pgClient.connect();
        await pgClient.query(
            `DELETE FROM official_applications WHERE discord_id = $1`,
            [userId]
        );
        await pgClient.end();

        const rejectedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setDescription('This application has been rejected.')
            .setColor(0xFF0000);

        await interaction.message.edit({
            content: 'The application has been rejected.',
            embeds: [rejectedEmbed],
            components: [],
        });

        await interaction.editReply({
            content: 'The application has been successfully rejected!',
            ephemeral: true,
        });

    } catch (error) {
        console.error('Error rejecting application:', error);

        if (!interaction.replied) {
            await interaction.editReply({
                content: 'There was an error while rejecting the application. Please try again later.',
                ephemeral: true,
            });
        }
    }
};

const handleNextStepsInteraction = async (interaction) => {
    const rejectionEmbed = new EmbedBuilder()
        .setTitle('Why Your Application Was Rejected and What to Do Next')
        .addFields(
            { name: 'Why was my application rejected?', value: `
- **Not Meeting Requirements**: You may not have met the basic eligibility, such as being Level 5 in the Gym Class Discord or having no recent moderation logs.
- **Incomplete Application**: Missing or incomplete information in your application or not agreeing to terms and rules can result in rejection.
            `},
            { name: 'What should I do next?', value: `
1. **Meet Basic Requirements**: Ensure you meet all the basic requirements, such as no moderation logs and reaching the required level in the Discord.
2. **Complete Your Application**: When reapplying, double-check that your application is complete and all required fields are filled out.
3. **Wait If Needed**: If rejected due to moderation logs, allow at least 1 month before reapplying.
            `}
        )
        .setColor(0xFF0000);

    await interaction.reply({
        embeds: [rejectionEmbed],
        ephemeral: true,
    });
};

const handleLfgSystem1Close = async (interaction) => {
    const pgClient = new Client(clientConfig);
    await pgClient.connect();

    try {
        const postMessageId = interaction.message.id;
        const userId = interaction.user.id;

        const result = await pgClient.query('SELECT post_owner_discord_id, discord_thread_id, participants FROM lfg_data WHERE post_message_id = $1', [postMessageId]);

        if (!result || result.rows.length === 0) {
            return interaction.reply({ content: 'LFG post not found.', ephemeral: true });
        }

        const { post_owner_discord_id: postOwnerId, discord_thread_id: threadId, participants = [] } = result.rows[0];

        if (userId !== postOwnerId) {
            return interaction.reply({ content: 'Only the post owner can close this LFG post.', ephemeral: true });
        }

        const thread = interaction.guild.channels.cache.get(threadId);
        if (thread) {
            await thread.delete('LFG post closed by owner');
        }

        await interaction.message.delete();
        await pgClient.query('DELETE FROM lfg_data WHERE post_message_id = $1', [postMessageId]);

        await interaction.reply({ content: 'Your LFG post has been closed!', ephemeral: true });
    } catch (error) {
        console.error('Error closing LFG post for System 1:', error);
        await interaction.reply({ content: 'An error occurred while closing the LFG post.', ephemeral: true });
    } finally {
        await pgClient.end();
    }
};

const handleLfgSystem1Join = async (interaction) => {
    const pgClient = new Client(clientConfig);
    await pgClient.connect();

    try {
        const result = await pgClient.query('SELECT post_owner_discord_id, participants, discord_thread_id FROM lfg_data WHERE post_message_id = $1', [interaction.message.id]);

        if (result.rows.length === 0) {
            return interaction.reply({ content: 'Could not find the LFG post in the database.', ephemeral: true });
        }

        const { post_owner_discord_id: postOwnerId, participants: currentParticipants, discord_thread_id: threadId } = result.rows[0];

        if (interaction.user.id === postOwnerId) {
            return interaction.reply({ content: 'You cannot join your own group.', ephemeral: true });
        }

        if (currentParticipants.includes(interaction.user.id)) {
            return interaction.reply({ content: 'You have already joined this group.', ephemeral: true });
        }

        currentParticipants.push(interaction.user.id);
        await pgClient.query('UPDATE lfg_data SET participants = $1 WHERE post_message_id = $2', [
            currentParticipants,
            interaction.message.id,
        ]);

        const recruitmentChannel = interaction.guild.channels.cache.get(interaction.channelId);
        const thread = await recruitmentChannel.threads.fetch(threadId);

        if (!thread) {
            return interaction.reply({ content: 'The recruitment thread could not be found.', ephemeral: true });
        }

        await thread.members.add(interaction.user.id);
        await thread.send(`Welcome <@${interaction.user.id}>! <@${postOwnerId}>, a new member has joined your recruitment thread.`);

        await interaction.reply({ content: 'You have successfully joined the group!', ephemeral: true });
    } catch (error) {
        console.error('Error joining the group.', error);
        await interaction.reply({ content: 'An error occurred while trying to join the group.', ephemeral: true });
    } finally {
        await pgClient.end();
    }
};

const handleLfgSystem1ViewParticipants = async (interaction) => {
    const pgClient = new Client(clientConfig);
    await pgClient.connect();

    try {
        const postMessageId = interaction.message.id;

        const result = await pgClient.query('SELECT participants FROM lfg_data WHERE post_message_id = $1', [postMessageId]);

        if (result.rows.length === 0) {
            return interaction.reply({ content: 'No participants found for this post.', ephemeral: true });
        }

        const participants = result.rows[0].participants;

        if (participants.length === 0) {
            return interaction.reply({ content: 'No participants have joined this group yet.', ephemeral: true });
        }

        const participantMentions = participants.map(userId => `<@${userId}>`).join('\n');

        const participantsEmbed = new EmbedBuilder()
            .setTitle('LFG Participants')
            .setDescription(`Here are the participants for this group:\n\n${participantMentions}`)
            .setColor(0x00FF00);

        await interaction.reply({ embeds: [participantsEmbed], ephemeral: true });

    } catch (error) {
        console.error('Error fetching participants.', error);
        await interaction.reply({ content: 'An error occurred while fetching the participants.', ephemeral: true });
    } finally {
        await pgClient.end();
    }
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
        return interaction.editReply({
            content: 'You need to be at least Level 5 to apply for a Base League. Try chatting with the community more to gain more level, best of luck!'
        });
    }

    const pgClient = new Client(clientConfig);
    await pgClient.connect();

    try {
        const inviteCodeMatch = discordInvite.match(/discord(?:app)?\.com\/invite\/([^\/\s]+)/i) || discordInvite.match(/discord\.gg\/([^\/\s]+)/i);
        if (!inviteCodeMatch) {
            return interaction.editReply({
                content: 'Invalid invite link format. Please provide a valid Discord invite link.'
            });
        }
        const inviteCode = inviteCodeMatch[1];

        const inviteResponse = await axios.get(`https://discord.com/api/v10/invites/${inviteCode}`, {
            params: {
                with_counts: true,
                with_expiration: true,
                with_metadata: true,
            },
            headers: {
                Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
            },
        });

        const inviteData = inviteResponse.data;

        if (inviteData.expires_at) {
            return interaction.editReply({
                content: 'Please provide an invite link that does not expire (set to "Never").'
            });
        }

        const guild = inviteData.guild;

        if (!guild) {
            return interaction.editReply({
                content: 'Invalid invite link or the guild is no longer available.'
            });
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
            `SELECT * FROM "Active Leagues" WHERE server_id = $1`,
            [serverId]
        );

        if (existingServer.rows.length > 0) {
            return interaction.editReply({
                content: 'This server is already registered as a Base League.'
            });
        }

        const existingLeague = await pgClient.query(
            `SELECT * FROM "Active Leagues" WHERE owner_id = $1 AND league_type = 'Base'`,
            [user.id]
        );

        if (existingLeague.rows.length > 0) {
            return interaction.editReply({
                content: 'You already own a Base League.'
            });
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

        await interaction.editReply({
            content: 'Your Base League has been registered successfully!'
        });

        const logChannelId = '1298997780303315016';
        const logChannel = await interaction.client.channels.fetch(logChannelId);

        if (logChannel) {
            const embed = new EmbedBuilder()
                .setTitle('New Base League Registered')
                .addFields(
                    { name: 'Owner', value: `<@${user.id}>`, inline: true },
                    { name: 'League Name', value: leagueName, inline: true },
                    { name: 'Server Name', value: serverName, inline: true },
                    { name: 'Invite Link', value: discordInvite, inline: false },
                    { name: 'Member Count', value: memberCount.toString(), inline: true },
                )
                .setThumbnail(ownerProfilePicture)
                .setTimestamp();

            await logChannel.send({ embeds: [embed] });
        } else {
            console.error('Log channel not found.');
        }

    } catch (error) {
        console.error('Error in handleApplyBaseLeagueModal:', error);

        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: 'An error occurred while processing your application.',
                ephemeral: true,
            });
        } else {
            await interaction.editReply({
                content: 'An error occurred while processing your application.',
            });
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
            return interaction.reply({ content: 'League application not found.', ephemeral: true });
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
            serverFeatures: 'None',
        };

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
                    serverFeatures: guild.features.length > 0 ? guild.features.join(', ') : serverData.serverFeatures,
                };
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
            await member.send(`Your application to upgrade your league "${application.league_name}" to ${application.applied_league_level} League has been approved. Please navigate to #league-owners for further instructions.`);
            console.log('Approval DM sent to the applicant.');
        } catch (error) {
            console.error('Error sending DM to the applicant:', error);
        }

        const message = interaction.message;
        const embed = EmbedBuilder.from(message.embeds[0]);
        embed.setDescription('This application has been approved.');
        await message.edit({ embeds: [embed], components: [] });
        console.log('Updated application message to indicate approval.');

        await interaction.reply({ content: 'Application has been approved.', ephemeral: true });
    } catch (error) {
        console.error('Error in handleApproveLeague:', error);
    } finally {
        await pgClient.end();
    }
};

const handleDenyLeagueModal = async (interaction) => {
    console.log('handleDenyLeagueModal called with customId:', interaction.customId);
    try {
        const denialReason = interaction.fields.getTextInputValue('denial-reason');
        console.log('Denial reason:', denialReason);

        const [action, messageId] = interaction.customId.split(':');
        console.log('Action:', action, 'Message ID:', messageId);


        const pgClient = new Client(clientConfig);
        await pgClient.connect();

        const res = await pgClient.query('SELECT * FROM "League Applications" WHERE application_message_id = $1', [messageId]);
        console.log('Database query result:', res.rows);

        if (res.rows.length === 0) {
            await interaction.reply({ content: 'League application not found.', ephemeral: true });
            return;
        }

        const application = res.rows[0];

        let member;
        try {
            member = await interaction.guild.members.fetch(application.applicant_id);
            console.log('Fetched member:', member.user.tag);
        } catch (error) {
            console.error('Error fetching member:', error);
            await interaction.reply({ content: 'Could not fetch the applicant.', ephemeral: true });
            return;
        }

        await pgClient.query(
            'UPDATE "League Applications" SET review_status = $1, denial_reason = $2, reviewed_date = NOW(), reviewed_by = $3 WHERE application_message_id = $4',
            ['Denied', denialReason, interaction.user.id, messageId]
        );
        console.log('Application status updated in the database.');

        try {
            await member.send(`Your application to upgrade your league "${application.league_name}" has been denied.

Reason:
> ${denialReason}

You'll be contacted by a Community Developer to further explain what may be missing from your application shortly.`);
            console.log('DM sent to the applicant.');
        } catch (error) {
            console.error('Error sending DM to the applicant:', error);
        }
        try {
            const applicationChannel = interaction.channel;

            const message = await applicationChannel.messages.fetch(messageId);
            const embed = EmbedBuilder.from(message.embeds[0]);
            embed.setDescription('This application has been denied.');
            await message.edit({ embeds: [embed], components: [] });
            console.log('Application message updated.');
        } catch (error) {
            console.error('Error updating application message:', error);
        }

        await interaction.reply({ content: 'Application has been denied.', ephemeral: true });

    } catch (error) {
        console.error('Error in handleDenyLeagueModal:', error);
        if (!interaction.replied && !interaction.deferred) {
            try {
                await interaction.reply({ content: 'An error occurred while processing the denial.', ephemeral: true });
            } catch (replyError) {
                console.error('Error replying to interaction:', replyError);
            }
        }
    } finally {
        await pgClient.end();
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

const handleLfgSystem3Create = async (interaction) => {
    await interaction.deferReply({ ephemeral: true });

    const leagueName = interaction.fields.getTextInputValue('leagueNameSystem3');
    const gameDetails = interaction.fields.getTextInputValue('gameDetailsSystem3');
    const officialRequirements = interaction.fields.getTextInputValue('officialRequirementsSystem3');

    const embed = new EmbedBuilder()
        .setTitle('Looking For Officials')
        .setColor(0x00FF00)
        .setDescription('A league is looking for officials! Join now to help referee the game.')
        .addFields(
            { name: 'League Name', value: leagueName, inline: true },
            { name: 'Game Details', value: gameDetails, inline: false },
            { name: 'Officials Required', value: officialRequirements, inline: false },
        )
        .setFooter({ text: `Post by ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() })
        .setTimestamp();

    const joinButton = new ButtonBuilder()
        .setCustomId('lfgSystem3Join')
        .setLabel('Join as Official')
        .setStyle(ButtonStyle.Primary);

    const closePostButton = new ButtonBuilder()
        .setCustomId('lfgSystem3Close')
        .setLabel('Close Post')
        .setStyle(ButtonStyle.Danger);

    const actionRow = new ActionRowBuilder().addComponents(joinButton, closePostButton);

    const lfgChannel = interaction.guild.channels.cache.get('1286764324014260317');
    const message = await lfgChannel.send({ embeds: [embed], components: [actionRow] });

    const threadName = `${leagueName}-Officials-Thread`;
    const thread = await lfgChannel.threads.create({
        name: threadName,
        autoArchiveDuration: 1440,
        type: 12,
        reason: 'Officials recruitment thread',
    });

    await thread.members.add(interaction.user.id);
    await thread.send(`Welcome <@${interaction.user.id}>! Use this thread to manage your official recruitment process. \n-# to remove a participant please use /remove-participant user:`);

    const client = new Client(clientConfig);
    await client.connect();

    try {
        await client.query('INSERT INTO "lfo_data" ("post_owner_discord_id", "post_message_id", "discord_thread_id", "participants") VALUES ($1, $2, $3, $4)', [
            interaction.user.id,
            message.id,
            thread.id,
            [],
        ]);
    } finally {
        await client.end();
    }

    await interaction.editReply({ content: 'Your officials request post has been created!' });
};

const handleLfgSystem3Join = async (interaction) => {
    const pgClient = new Client(clientConfig);
    await pgClient.connect();

    const allowedRoles = [
        "1289776755132858460",
        "1286098187223957617",
        "1286098139513880648",
        "1286098091396698134",
    ];

    const sheetId = '14J4LOdWDa2mzS6HzVBzAJgfnfi8_va1qOWVsxnwB-UM';
    const sheetTabName = 'Officials LFO Interactions';

    try {
        const result = await pgClient.query(
            'SELECT post_owner_discord_id, participants, discord_thread_id FROM lfo_data WHERE post_message_id = $1',
            [interaction.message.id]
        );

        if (result.rows.length === 0) {
            return interaction.reply({ content: 'Could not find the recruitment post in the database.', ephemeral: true });
        }

        const { post_owner_discord_id: postOwnerId, participants: currentParticipants, discord_thread_id: threadId } = result.rows[0];

        if (interaction.user.id === postOwnerId) {
            return interaction.reply({ content: 'You cannot join your own recruitment post.', ephemeral: true });
        }

        if (currentParticipants.includes(interaction.user.id)) {
            return interaction.reply({ content: 'You have already joined this recruitment thread.', ephemeral: true });
        }

        const member = interaction.guild.members.cache.get(interaction.user.id);
        if (!member) {
            return interaction.reply({ content: 'Could not find your member data.', ephemeral: true });
        }

        const hasRequiredRole = allowedRoles.some(roleId => member.roles.cache.has(roleId));
        if (!hasRequiredRole) {
            return interaction.reply({ content: 'You do not have the required roles to join this recruitment thread.', ephemeral: true });
        }

        currentParticipants.push(interaction.user.id);
        await pgClient.query('UPDATE lfo_data SET participants = $1 WHERE post_message_id = $2', [
            currentParticipants,
            interaction.message.id,
        ]);

        const recruitmentChannel = interaction.guild.channels.cache.get(interaction.channelId);
        const thread = await recruitmentChannel.threads.fetch(threadId);
        if (!thread) {
            return interaction.reply({ content: 'The recruitment thread could not be found.', ephemeral: true });
        }
        await thread.members.add(interaction.user.id);
        await thread.send(`Welcome <@${interaction.user.id}>! <@${postOwnerId}>, a new official has joined your recruitment thread.`);
        const officialUsername = interaction.user.tag;
        const officialId = interaction.user.id;
        const postLink = `https://discord.com/channels/${interaction.guild.id}/${interaction.channelId}/${interaction.message.id}`;
        const timeJoined = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });

        const row = [officialUsername, officialId, postLink, timeJoined, 'FALSE'];

        await sheets.spreadsheets.values.append({
            spreadsheetId: sheetId,
            range: `${sheetTabName}!A:D`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [row],
            },
        });

        await interaction.reply({ content: 'You have successfully joined the recruitment thread as an official!', ephemeral: true });
    } catch (error) {
        console.error('Error joining recruitment thread or logging interaction:', error);
        await interaction.reply({ content: 'An error occurred while trying to join the recruitment thread.', ephemeral: true });
    } finally {
        await pgClient.end();
    }
};

const handleLfgSystem3Close = async (interaction) => {
    const pgClient = new Client(clientConfig);
    await pgClient.connect();

    try {
        const postMessageId = interaction.message.id;
        const userId = interaction.user.id;

        const result = await pgClient.query(
            'SELECT post_owner_discord_id, discord_thread_id FROM lfo_data WHERE post_message_id = $1',
            [postMessageId]
        );

        if (!result || result.rows.length === 0) {
            return interaction.reply({ content: 'Recruitment post not found.', ephemeral: true });
        }

        const { post_owner_discord_id: postOwnerId, discord_thread_id: threadId } = result.rows[0];

        if (userId !== postOwnerId) {
            return interaction.reply({ content: 'Only the post owner can close this recruitment post.', ephemeral: true });
        }

        const thread = interaction.guild.channels.cache.get(threadId);
        if (thread) {
            await thread.delete('Recruitment post closed by owner.');
        }

        const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor(0xFF0000)
            .setFooter({ text: 'This post is now closed.' });

        const disabledActionRow = new ActionRowBuilder().addComponents(
            interaction.message.components[0].components.map(component =>
                ButtonBuilder.from(component).setDisabled(true)
            )
        );

        await interaction.message.edit({
            embeds: [updatedEmbed],
            components: [disabledActionRow],
        });

        await pgClient.query('DELETE FROM lfo_data WHERE post_message_id = $1', [postMessageId]);

        await interaction.reply({ content: 'Your recruitment post has been closed and updated!', ephemeral: true });
    } catch (error) {
        console.error('Error closing recruitment post:', error);
        await interaction.reply({ content: 'An error occurred while closing the recruitment post.', ephemeral: true });
    } finally {
        await pgClient.end();
    }
};

const handleNext2 = async (interaction) => {
    try {
        await interaction.deferUpdate();

        const messageId = interaction.message.id;
        const paginationData = interaction.client.commandData.get(messageId);

        if (!paginationData) {
            console.error(`No pagination data found for message ID: ${messageId}`);
            return interaction.followUp({ content: 'Pagination data not found or has expired.', ephemeral: true });
        }

        const { posts, totalPages, username, userAvatar, runningAverage, weeklyAverages, weekDateMap } = paginationData;
        let { currentPage } = paginationData;

        currentPage += 1;

        if (currentPage > totalPages) {
            currentPage = totalPages;
        }

        paginationData.currentPage = currentPage;
        interaction.client.commandData.set(messageId, paginationData);

        let embed;
        if (currentPage === 1) {
            embed = new EmbedBuilder()
                .setTitle(`${username}'s Quality Scores - Overview`)
                .setThumbnail(userAvatar)
                .setColor('#32CD32')
                .addFields(
                    { name: '📈 Running Average (Season)', value: runningAverage.toString(), inline: true }
                );

            const weeklyFields = Object.entries(weeklyAverages).map(([week, score]) => {
                const weekNumber = parseInt(week, 10);
                let formattedDate = 'N/A';
                if (weekDateMap[weekNumber]) {
                    const [month, day] = weekDateMap[weekNumber].split('/').map(Number);
                    const dateObj = new Date(Date.UTC(SEASON_YEAR, month - 1, day, 12, 0, 0));
                    const unixTimestamp = Math.floor(dateObj.getTime() / 1000);
                    formattedDate = `<t:${unixTimestamp}:D>`;
                }
                return {
                    name: `📅 Week ${weekNumber}`,
                    value: `Date: ${formattedDate}\nAverage Score: ${score}`,
                    inline: true,
                };
            });

            if (weeklyFields.length > 0) {
                embed.addFields(weeklyFields);
            } else {
                embed.addFields({ name: '📅 Weekly Averages', value: 'No weekly data available.', inline: false });
            }
        } else {
            const postIndex = currentPage - 2;
            const post = posts[postIndex];

            if (!post) {
                throw new Error('Post data not found for the current page.');
            }

            embed = new EmbedBuilder()
                .setTitle(`${username}'s Quality Score - Post ${currentPage - 1} of ${totalPages - 1}`)
                .setThumbnail(userAvatar)
                .setColor('#00000f')
                .addFields(
                    { name: '📈 Score', value: post.score.toString(), inline: true },
                    { name: '❤️ Likes', value: post.likes.toString(), inline: true },
                    { name: '📅 Season Week Posted', value: `<t:${post.weekDate}:D>`, inline: true },
                    { name: '⏰ Date Posted', value: post.timestamp.toString(), inline: true },
                    { name: '🔗 URL', value: post.url, inline: false },
                    { name: '📝 Details', value: post.details, inline: false },
                )
                .setFooter({ text: `Page ${currentPage - 1} of ${totalPages - 1}` })
                .setTimestamp();
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
            embeds: [embed],
            components: [actionRow],
        });

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
            return interaction.followUp({ content: 'Pagination data not found or has expired.', ephemeral: true });
        }

        const { posts, totalPages, username, userAvatar, runningAverage, weeklyAverages, weekDateMap } = paginationData;
        let { currentPage } = paginationData;

        currentPage -= 1;

        if (currentPage < 1) {
            currentPage = 1;
        }

        paginationData.currentPage = currentPage;
        interaction.client.commandData.set(messageId, paginationData);

        let embed;
        if (currentPage === 1) {
            embed = new EmbedBuilder()
                .setTitle(`${username}'s Quality Scores - Overview`)
                .setThumbnail(userAvatar)
                .setColor('#32CD32')
                .addFields(
                    { name: '📈 Running Average (Season)', value: runningAverage.toString(), inline: true }
                );

            const weeklyFields = Object.entries(weeklyAverages).map(([week, score]) => {
                const weekNumber = parseInt(week, 10);
                let formattedDate = 'N/A';
                if (weekDateMap[weekNumber]) {
                    const [month, day] = weekDateMap[weekNumber].split('/').map(Number);
                    const dateObj = new Date(Date.UTC(SEASON_YEAR, month - 1, day, 12, 0, 0));
                    const unixTimestamp = Math.floor(dateObj.getTime() / 1000);
                    formattedDate = `<t:${unixTimestamp}:D>`;
                }
                return {
                    name: `📅 Week ${weekNumber}`,
                    value: `Date: ${formattedDate}\nAverage Score: ${score}`,
                    inline: true,
                };
            });

            if (weeklyFields.length > 0) {
                embed.addFields(weeklyFields);
            } else {
                embed.addFields({ name: '📅 Weekly Averages', value: 'No weekly data available.', inline: false });
            }
        } else {
            const postIndex = currentPage - 2;
            const post = posts[postIndex];

            if (!post) {
                throw new Error('Post data not found for the current page.');
            }

            embed = new EmbedBuilder()
                .setTitle(`${username}'s Quality Score - Post ${currentPage - 1} of ${totalPages - 1}`)
                .setThumbnail(userAvatar)
                .setColor('#00000f')
                .addFields(
                    { name: '📈 Score', value: post.score.toString(), inline: true },
                    { name: '❤️ Likes', value: post.likes.toString(), inline: true },
                    { name: '📅 Season Week Posted', value: `<t:${post.weekDate}:D>`, inline: true },
                    { name: '⏰ Date Posted', value: post.timestamp.toString(), inline: true },
                    { name: '🔗 URL', value: post.url, inline: false },
                    { name: '📝 Details', value: post.details, inline: false },
                )
                .setFooter({ text: `Page ${currentPage - 1} of ${totalPages - 1}` })
                .setTimestamp();
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
            embeds: [embed],
            components: [actionRow],
        });

    } catch (error) {
        console.error('Error handling Previous pagination:', error.message);
    }
};

module.exports = interactionHandler;