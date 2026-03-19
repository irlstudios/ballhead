const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
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
        .setName('apply-for-official')
        .setDescription('Submit an application to become an official'),
    async execute(interaction) {
        const levelRoles = [LEVEL_5_ROLE_ID, ...HIGHER_LEVEL_ROLES];

        const member = await interaction.guild.members.fetch(interaction.user.id);

        if (!levelRoles.some(roleId => member.roles.cache.has(roleId))) {
            const errorContainer = new ContainerBuilder();
            const block = buildTextBlock({ title: 'Role Required', subtitle: 'Official Application', lines: [`You must have <@&${LEVEL_5_ROLE_ID}>+ to apply for official.`] });
            if (block) errorContainer.addTextDisplayComponents(block);
            await interaction.reply({
                flags: MessageFlags.IsComponentsV2,
                components: [errorContainer],
                ephemeral: true
            });
            return;
        }

        const modal = createModal('officialApplicationModal');
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
    }
};
