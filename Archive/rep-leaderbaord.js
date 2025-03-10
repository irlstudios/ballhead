//TODO, need to add the rep add / remove and the GET endpoints to AWS so we dont need to host a local server.

const {SlashCommandBuilder, EmbedBuilder} = require('discord.js');
const axios = require('axios');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rep-leaderboard')
        .setDescription('Displays the top 10 users with the most rep'),

    async execute(interaction) {
        try {
            const response = await axios.get('http://localhost:3000/api/reputation/leaderboard');
            const leaderboard = response.data.filter(user => user.rep_count > 0);

            if (leaderboard.length === 0) {
                return interaction.reply('No reputation data available.');
            }

            const embed = new EmbedBuilder()
                .setColor(0x00ff00)
                .setTitle('🏆 Reputation Leaderboard')
                .setDescription('Top 10 users with the highest Rep')
                .setTimestamp();

            leaderboard.slice(0, 10).forEach((user, index) => {
                embed.addFields({
                    name: `#${index + 1}:`,
                    value: `<@!${user.user_id}> - **${user.rep_count} Rep**`,
                    inline: false,
                });
            });

            await interaction.reply({embeds: [embed]});
        } catch (error) {
            console.error('Error fetching leaderboard:', error);
            await interaction.reply('Failed to fetch the rep leaderboard. Please try again later.');
        }
    },
};
