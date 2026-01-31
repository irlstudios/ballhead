const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const { createModal } = require('../../modals/modalFactory');

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
        .setName('apply-ko-host')
        .setDescription('Submit an application to become a KO-Host'),
    async execute(interaction) {
        const modal = createModal('koHostApplicationModal');
        if (!modal) {
            const errorContainer = new ContainerBuilder();
            const block = buildTextBlock({ title: 'Form Unavailable', subtitle: 'KO-Host Application', lines: ['Unable to load the KO-Host application form right now.'] });
            if (block) errorContainer.addTextDisplayComponents(block);
            await interaction.reply({
                flags: MessageFlags.IsComponentsV2,
                components: [errorContainer],
                ephemeral: true
            });
            return;
        }

        await interaction.showModal(modal);
    }
};
