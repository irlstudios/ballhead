const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const { GUIDE_TOPICS, buildGuidePage, buildOverviewPage } = require('../../utils/product_guide');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('guide')
        .setDescription('Learn how everything in the server works')
        .addStringOption((option) =>
            option
                .setName('topic')
                .setDescription('Which system to explain')
                .setRequired(false)
                .addChoices(...Object.keys(GUIDE_TOPICS).map((key) => ({ name: key, value: key })))
        ),
    async execute(interaction) {
        const topic = interaction.options.getString('topic');
        const page = topic ? buildGuidePage(topic) : buildOverviewPage();
        const container = new ContainerBuilder();
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${page.title}`));
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(page.lines.join('\n')));
        await interaction.reply({ flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true });
    },
};
