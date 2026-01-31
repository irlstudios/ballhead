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
        .setName('apply-for-official')
        .setDescription('Submit an application to become an official'),
    async execute(interaction) {
        const levelRoles = [
            '924522770057031740',
            '924522921370714152',
            '924522979768016946',
            '924523044268032080',
            '1242262635223715971',
            '1087071951270453278',
            '1223408044784746656'
        ];

        const member = await interaction.guild.members.fetch(interaction.user.id);

        if (!levelRoles.some(roleId => member.roles.cache.has(roleId))) {
            const errorContainer = new ContainerBuilder();
            const block = buildTextBlock({ title: 'Role Required', subtitle: 'Official Application', lines: ['You must have <@&924522770057031740>+ to apply for official.'] });
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
