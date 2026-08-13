'use strict';

// RSVP buttons for scheduled squad practices. customId scheme:
// practice:rsvp:<practiceId>:Yes|No

const logger = require('../utils/logger');
const { noticePayload } = require('../utils/ui');
const squadDb = require('../utils/squad_db');
const { buildRsvpCardLines, rsvpComponents } = require('../commands/squads/squad_practice');
const { MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');

async function refreshRsvpCard(client, practice, squadName) {
    if (!practice.thread_id || !practice.rsvp_message_id) {
        return;
    }
    try {
        const thread = await client.channels.fetch(practice.thread_id);
        const message = await thread.messages.fetch(practice.rsvp_message_id);
        const yes = await squadDb.fetchRsvps(practice.id, 'Yes');
        const no = await squadDb.fetchRsvps(practice.id, 'No');
        const container = new ContainerBuilder();
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`## [${squadName}] Practice`),
            new TextDisplayBuilder().setContent(buildRsvpCardLines(practice, yes, no).join('\n'))
        );
        await message.edit({ flags: MessageFlags.IsComponentsV2, components: [container, rsvpComponents(practice.id)] });
    } catch (error) {
        logger.error(`[Practice] Failed to refresh RSVP card for practice ${practice.id}:`, error.message);
    }
}

async function handlePracticeButton(interaction) {
    const [, action, idStr, response] = interaction.customId.split(':');
    if (action !== 'rsvp' || !['Yes', 'No'].includes(response)) {
        logger.warn('[Practice] Unknown button action:', interaction.customId);
        return;
    }
    await interaction.deferReply({ ephemeral: true });

    const practice = await squadDb.fetchPracticeById(parseInt(idStr, 10));
    if (!practice || practice.status !== 'Scheduled') {
        return interaction.editReply(noticePayload('This practice is no longer taking RSVPs.', { title: 'RSVPs Closed', subtitle: 'Squad Practice' }));
    }

    await squadDb.upsertRsvp(practice.id, interaction.user.id, response);
    const squad = await squadDb.fetchSquadById(practice.squad_id);
    await refreshRsvpCard(interaction.client, practice, squad?.name || 'Squad');

    return interaction.editReply(noticePayload(
        response === 'Yes'
            ? 'You are in. You will get a reminder DM 15 minutes before start.'
            : 'Noted, you are marked as unavailable.',
        { title: 'RSVP Saved', subtitle: 'Squad Practice' }
    ));
}

module.exports = { handlePracticeButton, refreshRsvpCard };
