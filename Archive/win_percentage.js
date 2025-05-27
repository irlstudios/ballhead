const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('win_percentage')
        .setDescription('Calculates win percentage based on wins and games played.')
        .addIntegerOption(option =>
            option
                .setName('wins')
                .setDescription('Number of wins')
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option
                .setName('games')
                .setDescription('Number of games played')
                .setRequired(true)
        ),
    async execute(interaction) {
        const wins = interaction.options.getInteger('wins');
        const games = interaction.options.getInteger('games');

        if (games <= 0) {
            return interaction.reply({ content: 'Games played must be greater than zero.', ephemeral: true });
        }
        if (wins < 0) {
            return interaction.reply({ content: 'Wins cannot be negative.', ephemeral: true });
        }
        if (wins > games) {
            return interaction.reply({ content: 'Wins cannot exceed games played.', ephemeral: true });
        }

        const winPercentage = (wins / games) * 100;
        const roundedPercentage = Math.round(winPercentage * 100) / 100;

        await interaction.reply(`Win Percentage: ${roundedPercentage}%`);
    }
};