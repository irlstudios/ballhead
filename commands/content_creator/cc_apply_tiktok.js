const {SlashCommandBuilder} = require('@discordjs/builders');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('tiktok-cc-apply')
        .setDescription('Get TikTok application instructions.'),
    async execute(interaction) {
        await interaction.reply({
            content: 'TikTok applications are now handled in the GC mobile app. Open the GC app and link your TikTok account from there.\nUse `/cc_status` for status updates.',
            ephemeral: true
        });
    }
};
