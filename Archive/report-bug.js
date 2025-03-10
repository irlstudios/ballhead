const {
    SlashCommandBuilder,
    ModalBuilder,
    TextInputBuilder,
    ActionRowBuilder,
    TextInputStyle,
    EmbedBuilder
} = require('discord.js');
const axios = require('axios');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('report-bug')
        .setDescription('Report a bug you encountered with the bot.')
        .addStringOption(option =>
            option.setName('command')
                .setDescription('The command that encountered the bug')
                .setRequired(true)
        ),
    async execute(interaction) {
        const commandName = interaction.options.getString('command');
        const modal = new ModalBuilder()
            .setCustomId(`report-bug:${commandName}`)
            .setTitle('Report a Bug');

        const errorInput = new TextInputBuilder()
            .setCustomId('bug-error')
            .setLabel('What error did you receive?')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

        const stepsInput = new TextInputBuilder()
            .setCustomId('bug-steps')
            .setLabel('How did you run into this error?')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder().addComponents(errorInput),
            new ActionRowBuilder().addComponents(stepsInput)
        );

        try {
            await interaction.showModal(modal);
        } catch (error) {
            console.error('Failed to show modal:', error);
            await interaction.reply({content: "Error showing the modal.", ephemeral: true});

            try {
                const errorGuild = await interaction.client.guilds.fetch('1233740086839869501');
                const errorChannel = await errorGuild.channels.fetch('1233853458092658749');
                const errorEmbed = new EmbedBuilder()
                    .setTitle('Error')
                    .setDescription(`An error occurred while executing the report-bug command: ${error.message}`)
                    .setColor('#FF0000');
                await errorChannel.send({embeds: [errorEmbed]});
            } catch (logError) {
                console.error('Failed to log error:', logError);
            }
        }
    }
};
