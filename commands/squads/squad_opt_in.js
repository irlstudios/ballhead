'use strict';

const { SlashCommandBuilder, MessageFlags, ContainerBuilder } = require('discord.js');
const { buildTextBlock } = require('../../utils/ui');
const squadDb = require('../../utils/squad_db');
const logger = require('../../utils/logger');

function payload(title, lines) {
    const container = new ContainerBuilder();
    const block = buildTextBlock({ title, subtitle: 'Squad Invitations', lines });
    if (block) container.addTextDisplayComponents(block);
    return { flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('squad-opt-in')
        .setDescription('Opt back into receiving squad invitations.'),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const userId = interaction.user.id;

        try {
            if (await squadDb.getInvitesOptIn(userId)) {
                return interaction.editReply(payload('Already Opted In', ['You are already opted in to receive squad invitations.']));
            }
            await squadDb.setInvitesOptIn(userId, true);
            return interaction.editReply(payload('Opt-In Confirmed', ['You have successfully opted back in to receive squad invitations.']));
        } catch (error) {
            logger.error(`Error during squad-opt-in command for ${userId}:`, error);
            return interaction.editReply(payload('Request Failed', ['An error occurred while processing your request.', 'Please try again later.']));
        }
    },
};
