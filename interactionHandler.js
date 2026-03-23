'use strict';

require('dotenv').config({ path: './resources/.env' });
const { Collection, MessageFlags, ContainerBuilder } = require('discord.js');
const logCommandUsage = require('./API/command-data');
const { createModal } = require('./modals/modalFactory');
const logger = require('./utils/logger');
const { buildTextBlock, noticePayload } = require('./utils/ui');
const { BALLHEAD_GUILD_ID, BOT_BUGS_CHANNEL_ID } = require('./config/constants');

// Handler modules
const { handleBugReport, handleSnackModal, handleKoHostApplication, handleRankedSessionModal, handleGenerateTemplateModal } = require('./handlers/modals');
const { handleOfficialsApplicationSubmission, handleOfficialsApplicationApprove, handleOfficialsApplicationReject, handleQnAInteraction, handleNextStepsInteraction } = require('./handlers/officials');
const { handleApplyBaseLeagueModal, handleApproveLeague, handleDenyLeagueModal, handleDenyLeagueButton } = require('./handlers/leagues');
const { handleNext2, handlePrev2, handlePagination1 } = require('./handlers/pagination');
const { handleLfgButton } = require('./handlers/lfg');
const {
    buildFriendlyFireLeaderboardPayload,
    FF_LEADERBOARD_DEFAULT_CATEGORY,
    ERROR_LOG_CHANNEL_ID: FF_LEADERBOARD_ERROR_LOG_CHANNEL_ID,
    ERROR_LOG_GUILD_ID: FF_LEADERBOARD_ERROR_LOG_GUILD_ID,
} = require('./commands/friendly_fire/friendly_fire_leaderboard');
const { handleInviteButton } = require('./handlers/invites');
const {
    buildSquadLeaderboardPayload,
    DEFAULT_VIEW: SQUAD_LEADERBOARD_DEFAULT_VIEW,
} = require('./commands/squads/squad_leaderboard');

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
            await handleModalSubmit(interaction);
        } else if (interaction.isButton()) {
            await handleButton(interaction, client);
        }
    } catch (error) {
        logger.error('Error handling interaction:', error);

        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                ...noticePayload(
                    'We encountered an error while processing your request. \n -# if this issue persists please reach out to support to escalate your issue to the developers \n -# Do note, this error has been logged internally and will be investigated.',
                    { title: 'Request Failed', subtitle: 'Interaction Error' }
                ),
                ephemeral: true,
            }).catch((err) => {
                if (err.code === 10062) {
                    logger.error('Interaction expired and cannot be replied to.');
                } else {
                    logger.error('Failed to reply to interaction:', err);
                }
            });
        }

        try {
            const errorGuild = await interaction.client.guilds.fetch(BALLHEAD_GUILD_ID);
            const errorChannel = await errorGuild.channels.fetch(BOT_BUGS_CHANNEL_ID);
            const errorContainer = new ContainerBuilder();
            const block = buildTextBlock({
                title: 'Interaction Error',
                subtitle: 'Unhandled interaction failure',
                lines: [`An error occurred while processing an interaction: ${error.message}`],
            });
            if (block) errorContainer.addTextDisplayComponents(block);
            await errorChannel.send({ flags: MessageFlags.IsComponentsV2, components: [errorContainer] });
        } catch (logError) {
            logger.error('Failed to log error:', logError);
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
            return await interaction.reply({
                ...noticePayload(
                    `You are on cooldown for the \`${command.data.name}\` command. Please wait ${timeLeft} second(s) before using it again.`,
                    { title: 'Cooldown Active', subtitle: 'Command Cooldown' }
                ),
                ephemeral: true,
            });
        }
    }

    timestamps.set(interaction.user.id, now);
    setTimeout(() => timestamps.delete(interaction.user.id), cooldownAmount);

    try {
        await command.execute(interaction);
    } catch (error) {
        logger.error('Error executing command:', error);

        if (interaction.replied || interaction.deferred) {
            await interaction.editReply({
                ...noticePayload(
                    'We encountered an error while processing the command. If this issue persists, please contact support.',
                    { title: 'Command Error', subtitle: 'Execution Failed' }
                ),
            }).catch((err) => {
                if (err.code === 10062) {
                    logger.error('Interaction expired and cannot be edited.');
                } else {
                    logger.error('Failed to edit reply:', err);
                }
            });
        } else {
            await interaction.reply({
                ...noticePayload(
                    'An error occurred while executing the command.',
                    { title: 'Command Error', subtitle: 'Execution Failed' }
                ),
                ephemeral: true,
            }).catch((err) => {
                if (err.code === 10062) {
                    logger.error('Interaction expired and cannot be replied to.');
                } else {
                    logger.error('Failed to reply to an interaction:', err);
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
                    'We encountered an error while processing your modal submission. \n -# if this issue persists please reach out to support to escalate your issue to the developers \n -# Do note, this error has been logged internally and will be investigated.',
                    { title: 'Modal Error', subtitle: 'Submission Failed' }
                ),
                ephemeral: true,
            });
        }
        return;
    }
    if (interaction.customId === 'ff-leaderboard-select') {
        await handleFFLeaderboardSelect(interaction);
        return;
    }
    if (interaction.customId === 'squad-leaderboard-select') {
        await handleSquadLeaderboardSelect(interaction);
        return;
    }
};

const handleModalSubmit = async (interaction) => {
    const [action, customId] = interaction.customId.split(':');

    const modalRoutes = {
        'report-bug': () => handleBugReport(interaction, customId),
        'officialApplicationModal': () => handleOfficialsApplicationSubmission(interaction),
        'generateTemplateModal_kotc': () => handleGenerateTemplateModal(interaction),
        'generateTemplateModal_gc': () => handleGenerateTemplateModal(interaction),
        'apply-base-league-modal': () => handleApplyBaseLeagueModal(interaction),
        'denyLeagueModal': () => handleDenyLeagueModal(interaction),
        'koHostApplicationModal': () => handleKoHostApplication(interaction),
        'rankedSessionModal': () => handleRankedSessionModal(interaction),
        'snack_modal': () => handleSnackModal(interaction),
    };

    const handler = modalRoutes[action];
    if (handler) {
        await handler();
        return;
    }

    logger.warn('Unhandled modal action:', action);
    await interaction.reply({
        ...noticePayload('This modal is not recognized.', { title: 'Unknown Modal', subtitle: 'Modal Submission' }),
        ephemeral: true,
    });
};

const handleButton = async (interaction, client) => {
    try {
        const [action, customId] = interaction.customId.split('_');
        if (!interaction.isButton() || interaction.message.partial) {
            await interaction.message.fetch();
        }

        const buttonRoutes = {
            'invite': () => handleInviteButton(interaction, customId),
            'pagination1': () => handlePagination1(interaction, customId),
            'next2': () => handleNext2(interaction),
            'prev2': () => handlePrev2(interaction),
            'approve': () => handleOfficialsApplicationApprove(interaction, client),
            'reject': () => handleOfficialsApplicationReject(interaction, client),
            'officialsQna': () => handleQnAInteraction(interaction),
            'officialsQnaReject': () => handleNextStepsInteraction(interaction),
            'approveLeague': () => handleApproveLeague(interaction),
            'denyLeague': () => handleDenyLeagueButton(interaction),
        };

        if (action.startsWith('lfg:')) {
            await handleLfgButton(interaction);
            return;
        }

        const handler = buttonRoutes[action];
        if (handler) {
            await handler();
        } else {
            await interaction.reply({
                ...noticePayload(
                    'We encountered an error while processing your button interaction. \n-# if this issue persists please reach out to support to escalate your issue to the developers \n-# Do note, this error has been logged internally and will be investigated.',
                    { title: 'Button Error', subtitle: 'Interaction Failed' }
                ),
                ephemeral: true,
            });
        }
    } catch (error) {
        logger.error('Button Error', error);
        if (!interaction.replied) {
            await interaction.reply({
                ...noticePayload(
                    'An error occurred while processing your button interaction.',
                    { title: 'Button Error', subtitle: 'Interaction Failed' }
                ),
                ephemeral: true,
            });
        }
    }
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
            files: result.files,
        });
    } catch (error) {
        logger.error('Error updating Friendly Fire leaderboard:', error);
        try {
            const errorGuild = await interaction.client.guilds.fetch(FF_LEADERBOARD_ERROR_LOG_GUILD_ID);
            const errorChannel = await errorGuild.channels.fetch(FF_LEADERBOARD_ERROR_LOG_CHANNEL_ID);
            const errorContainer = new ContainerBuilder();
            const block = buildTextBlock({
                title: 'Leaderboard Update Error',
                subtitle: 'Friendly Fire leaderboard failed',
                lines: [`**Error:** ${error.message}`],
            });
            if (block) errorContainer.addTextDisplayComponents(block);
            await errorChannel.send({ flags: MessageFlags.IsComponentsV2, components: [errorContainer] });
        } catch (logError) {
            logger.error('Failed to log FF leaderboard error:', logError);
        }
        await interaction.followUp({
            ...noticePayload('An error occurred while updating the leaderboard.', { title: 'Leaderboard Error', subtitle: 'Friendly Fire' }),
            ephemeral: true,
        }).catch(e => logger.error('FF followUp failed:', e));
    }
};

const handleSquadLeaderboardSelect = async (interaction) => {
    const view = interaction.values[0] || SQUAD_LEADERBOARD_DEFAULT_VIEW;
    await interaction.deferUpdate();
    try {
        const result = await buildSquadLeaderboardPayload(view, interaction.client);
        if (result.errorContainer) {
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [result.errorContainer] });
            return;
        }
        await interaction.editReply({
            flags: MessageFlags.IsComponentsV2,
            components: result.components,
            files: result.files,
        });
    } catch (error) {
        logger.error('Error updating Squad leaderboard:', error);
        try {
            const errorGuild = await interaction.client.guilds.fetch(BALLHEAD_GUILD_ID);
            const errorChannel = await errorGuild.channels.fetch(BOT_BUGS_CHANNEL_ID);
            const errorContainer = new ContainerBuilder();
            const block = buildTextBlock({
                title: 'Leaderboard Update Error',
                subtitle: 'Squad leaderboard failed',
                lines: [`**Error:** ${error.message}`],
            });
            if (block) errorContainer.addTextDisplayComponents(block);
            await errorChannel.send({ flags: MessageFlags.IsComponentsV2, components: [errorContainer] });
        } catch (logError) {
            logger.error('Failed to log Squad leaderboard error:', logError);
        }
        await interaction.followUp({
            ...noticePayload('An error occurred while updating the leaderboard.', { title: 'Leaderboard Error', subtitle: 'Squad Leaderboard' }),
            ephemeral: true,
        }).catch(e => logger.error('Squad leaderboard followUp failed:', e));
    }
};

module.exports = interactionHandler;
