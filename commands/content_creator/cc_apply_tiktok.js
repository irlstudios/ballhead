const {SlashCommandBuilder} = require('@discordjs/builders');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('tiktok-cc-apply')
        .setDescription('Get instructions to apply for the TikTok Content Creator role'),
    async execute(interaction) {
        await interaction.reply({
            content: 'TikTok applications are now handled in the GC mobile app. Open the GC app and follow the TikTok creator application flow there.',
            ephemeral: true
        });
    }
};
