const {
    SlashCommandBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
} = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('generate-template')
        .setDescription('Generate a template for hosting a session')
        .addStringOption(option =>
            option.setName('type')
                .setDescription('Choose the session type')
                .setRequired(true)
                .addChoices(
                    { name: 'KOTC Session (FF)', value: 'kotc' },
                    { name: 'GC Officials Session', value: 'gc_officials' }
                )
        ),
    async execute(interaction) {
        const type = interaction.options.getString('type');

        let modal;
        if (type === 'kotc') {
            modal = new ModalBuilder()
                .setCustomId('generateTemplateModal_kotc')
                .setTitle('KOTC Session Details')
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('ingamename')
                            .setLabel('What is your in-game name?')
                            .setStyle(TextInputStyle.Short)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('gamemode')
                            .setLabel('What game mode are you hosting?')
                            .setStyle(TextInputStyle.Short)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('courtname')
                            .setLabel('What is the exact name of your PRO Court?')
                            .setStyle(TextInputStyle.Short)
                    )
                );
        } else if (type === 'gc_officials') {
            modal = new ModalBuilder()
                .setCustomId('generateTemplateModal_gc')
                .setTitle('GC Officials Session Details')
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('ingamename')
                            .setLabel('What is your in-game name?')
                            .setStyle(TextInputStyle.Short)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('gamemode')
                            .setLabel('What game mode are you hosting?')
                            .setStyle(TextInputStyle.Short)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('courtname')
                            .setLabel('What is the exact name of your PRO Court?')
                            .setStyle(TextInputStyle.Short)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('ruleset')
                            .setLabel('What rule set are you following?')
                            .setStyle(TextInputStyle.Short)
                    )
                );
        }

        await interaction.showModal(modal);
    },
};
