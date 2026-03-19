const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const { createModal } = require('../../modals/modalFactory');
const { LEVEL_5_ROLE_ID, HIGHER_LEVEL_ROLES } = require('../../config/constants');

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

module.exports = {
    data: new SlashCommandBuilder()
        .setName('apply-base-league')
        .setDescription('Apply to register a Base League'),
    async execute(interaction) {
        const userRoles = interaction.member.roles.cache;
        const hasRequiredRole = userRoles.has(LEVEL_5_ROLE_ID) || HIGHER_LEVEL_ROLES.some(roleId => userRoles.has(roleId));

        if (!hasRequiredRole) {
            const errorContainer = new ContainerBuilder();
            const block = buildTextBlock({ title: 'Level Requirement', subtitle: 'Base League Application', lines: ['You need to be at least Level 5 to apply for a Base League.'] });
            if (block) errorContainer.addTextDisplayComponents(block);
            return interaction.reply({
                flags: MessageFlags.IsComponentsV2,
                components: [errorContainer],
                ephemeral: true
            });
        }

        const modal = createModal('apply-base-league-modal');
        if (modal) {
            await interaction.showModal(modal);
        } else {
            const errorContainer = new ContainerBuilder();
            const block = buildTextBlock({ title: 'Form Unavailable', subtitle: 'Try Again Soon', lines: ['Error loading the application form.'] });
            if (block) errorContainer.addTextDisplayComponents(block);
            await interaction.reply({
                flags: MessageFlags.IsComponentsV2,
                components: [errorContainer],
                ephemeral: true
            });
        }
    } };
