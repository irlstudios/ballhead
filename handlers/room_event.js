'use strict';

// The /room event start flow: eligibility checks, the confirmation prompt, and
// the button that actually opens the session. Kept out of room_commands.js, which
// is already at the project's file-size ceiling.

const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags,
} = require('discord.js');
const { pool } = require('../db');
const { HOST_ROLE_ID, HOST_SESSION_NUDGE_MINUTES } = require('../config/constants');
const { buildTextBlock } = require('../utils/ui');
const { eventChannelName } = require('../utils/host_session_stats');
const manager = require('../utils/host_session_manager');
const store = require('../utils/host_session_queries');
const { statusNotice } = require('../utils/host_session_dms');
const logger = require('../utils/logger');

const CONFIRM_PREFIX = 'roomevt:';
const isRoomEventInteraction = (customId) => typeof customId === 'string' && customId.startsWith(CONFIRM_PREFIX);

const ephemeral = (interaction, notice) => {
    const container = new ContainerBuilder();
    const block = buildTextBlock(notice);
    if (block) container.addTextDisplayComponents(block);
    return interaction.reply({
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        components: [container],
    });
};

// The room must be one the bot created and the caller must be its host, which is
// the same gate every other /room subcommand uses.
const resolveHostedRoom = async (interaction, subtitle) => {
    const channel = interaction.member.voice.channel;
    if (!channel) {
        await ephemeral(interaction, {
            title: 'Room Required',
            subtitle,
            lines: ['Join your lobby before starting an event.'],
        });
        return null;
    }
    const { rows } = await pool.query('SELECT host_id FROM vc_hosts WHERE channel_id = $1', [channel.id]);
    const hostId = rows[0]?.host_id;
    if (!hostId) {
        await ephemeral(interaction, {
            title: 'Unmanaged Room',
            subtitle,
            lines: ['This channel is not one of the bot-managed lobbies, so it cannot host a tracked event.'],
        });
        return null;
    }
    if (hostId !== interaction.user.id) {
        await ephemeral(interaction, {
            title: 'Access Denied',
            subtitle,
            lines: ['Only the host of this lobby can start an event in it.'],
        });
        return null;
    }
    return channel;
};

const handleRoomEventStart = async (interaction) => {
    const subtitle = 'Start Event';

    if (!interaction.member.roles.cache.has(HOST_ROLE_ID)) {
        return ephemeral(interaction, {
            title: 'Host Role Required',
            subtitle,
            lines: ['Only members with the host role can start an event session.'],
        });
    }

    const channel = await resolveHostedRoom(interaction, subtitle);
    if (!channel) return undefined;

    if (manager.getSessionByChannel(channel.id)) {
        return ephemeral(interaction, {
            title: 'Session Already Running',
            subtitle,
            lines: ['This lobby already has an event session running.'],
        });
    }

    const container = new ContainerBuilder().setAccentColor(0x14B8A6);
    const block = buildTextBlock({
        title: 'Start Event Session',
        subtitle,
        lines: [
            `This will rename **${channel.name}** to **${eventChannelName(interaction.member.displayName)}** and let everyone launch Discord activities in it.`,
            '',
            'While the event runs:',
            '- Tracking starts as soon as you launch an activity, not before. I will DM you the moment it does.',
            `- The bot posts an invite to the lobby in general chat every ${HOST_SESSION_NUDGE_MINUTES} minutes.`,
            '- You will not be able to lock or rename the lobby.',
            '- `/room event status` shows your live stats at any time.',
            '',
            '**Tracking stops the moment you leave the lobby**, and the session stats are written to the sheet then. Leaving ends the event.',
        ],
    });
    if (block) container.addTextDisplayComponents(block);

    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${CONFIRM_PREFIX}confirm:${channel.id}`)
            .setLabel('Start Session')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`${CONFIRM_PREFIX}cancel:${channel.id}`)
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary)
    );

    return interaction.reply({
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        components: [container, buttons],
    });
};

const editEphemeral = (interaction, notice) => {
    const container = new ContainerBuilder();
    const block = buildTextBlock(notice);
    if (block) container.addTextDisplayComponents(block);
    // No Ephemeral flag on an edit: the message is already ephemeral, and passing
    // it back is rejected. Replacing components also drops the buttons.
    return interaction.editReply({
        flags: MessageFlags.IsComponentsV2,
        components: [container],
    });
};

const handleRoomEventButton = async (interaction) => {
    const [, action, channelId] = interaction.customId.split(':');
    await interaction.deferUpdate();

    if (action === 'cancel') {
        return editEphemeral(interaction, {
            title: 'Cancelled',
            subtitle: 'Start Event',
            lines: ['No session was started.'],
        });
    }

    // Re-checked rather than trusted from the prompt: the host may have moved
    // rooms or lost the role between opening the confirmation and pressing it.
    const channel = interaction.member.voice.channel;
    if (!channel || channel.id !== channelId) {
        return editEphemeral(interaction, {
            title: 'Room Required',
            subtitle: 'Start Event',
            lines: ['You are no longer in that lobby. Rejoin it and run the command again.'],
        });
    }
    if (!interaction.member.roles.cache.has(HOST_ROLE_ID)) {
        return editEphemeral(interaction, {
            title: 'Host Role Required',
            subtitle: 'Start Event',
            lines: ['Only members with the host role can start an event session.'],
        });
    }

    try {
        const session = await manager.startSession({ channel, hostMember: interaction.member });
        if (!session) {
            return editEphemeral(interaction, {
                title: 'Session Already Running',
                subtitle: 'Start Event',
                lines: ['You already have an event session running.'],
            });
        }
        return editEphemeral(interaction, {
            title: 'Session Started',
            subtitle: 'Start Event',
            lines: [
                'The lobby is open for Discord activities. Launch one and tracking begins automatically.',
                'I will DM you when tracking starts. No DM within a few minutes means the activity is not being detected; run `/room event status` to check.',
                'Stats are saved and DMed to you when you leave the lobby.',
            ],
        });
    } catch (error) {
        logger.error('[Host Session] Failed to start session from confirmation button:', error);
        return editEphemeral(interaction, {
            title: 'Could Not Start Session',
            subtitle: 'Start Event',
            lines: ['The lobby could not be opened up. Check the bot has Manage Channels here, then try again.'],
        });
    }
};

// Answerable from anywhere, not just the lobby: a host asking whether tracking
// works should not have to leave the room (which would end the session) to ask.
const handleRoomEventStatus = async (interaction) => {
    const session = await store.getActiveSessionByHost(interaction.user.id);
    if (!session) {
        return ephemeral(interaction, {
            title: 'No Active Session',
            subtitle: 'Session Status',
            lines: ['You have no event session running. Start one with `/room event start`.'],
        });
    }
    const channel = await interaction.client.channels.fetch(session.channelId).catch(() => null);
    const currentParticipants = channel?.members
        ? channel.members.filter((member) => !member.user.bot && member.id !== session.hostId).size
        : null;
    const members = await store.listSessionMembers(session.id);
    return ephemeral(interaction, statusNotice({ session, members, currentParticipants }));
};

module.exports = {
    CONFIRM_PREFIX,
    isRoomEventInteraction,
    handleRoomEventStart,
    handleRoomEventStatus,
    handleRoomEventButton,
};
