const {SlashCommandBuilder} = require('@discordjs/builders');
const { MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');

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
        .setName('tiktok-cc-apply')
        .setDescription('Get TikTok application instructions.'),
    async execute(interaction) {
        const infoContainer = new ContainerBuilder();
        const block = buildTextBlock({ title: 'TikTok Applications',
            subtitle: 'Handled in the GC mobile app', lines: [
            'TikTok applications are handled in the GC mobile app.',
            'Open the app and link your TikTok account from there.',
            'Use `/cc_status` for updates.'
        ] });
            if (block) infoContainer.addTextDisplayComponents(block);
        await interaction.reply({
            flags: MessageFlags.IsComponentsV2,
            components: [infoContainer],
            ephemeral: true
        });
    }
};
