const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const { Client } = require('pg');

const clientConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    database: process.env.DB_DATABASE_NAME,
    password: process.env.DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
};  

module.exports = {
    data: new SlashCommandBuilder()
        .setName('top-tb-applicants')
        .setDescription('Fetch the top 10 applicants based on rules, response, and rep'),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const pgClient = new Client(clientConfig);

        try {
            await pgClient.connect();

            const query = `
                SELECT 
                    tb_applications.discord_id,
                    tb_applications.discord_username,
                    tb_applications.application_link,
                    user_reputation.rep_count,
                    LENGTH(tb_applications.tb_meaning_response) AS response_length
                FROM tb_applications
                LEFT JOIN user_reputation
                ON tb_applications.discord_id = user_reputation.user_id
                WHERE 
                    tb_applications.agreed_to_rule_1 = TRUE
                    AND tb_applications.agreed_to_rule_2 = TRUE
                    AND tb_applications.agreed_to_rule_3 = TRUE
                    AND LENGTH(tb_applications.tb_meaning_response) > 20
                ORDER BY 
                    user_reputation.rep_count DESC NULLS LAST,
                    tb_applications.discord_username ASC 
                LIMIT 10;
            `;

            const result = await pgClient.query(query);

            if (result.rows.length === 0) {
                await interaction.editReply({ content: 'No applicants meet the criteria.', ephemeral: true });
                return;
            }

            const topApplicants = result.rows.map((row, index) => ({
                name: `${index + 1}. ${row.discord_username}`,
                value: `**ID:** ${row.discord_id}\n**Application:** [Link](${row.application_link})\n**Rep:** ${row.rep_count || 0}`,
            }));

            const embed = new EmbedBuilder()
                .setTitle('Top 10 True Baller Applicants')
                .setDescription('Based on rule agreement, response length, and reputation.')
                .setColor(0x00ff00)
                .addFields(topApplicants);
            await interaction.editReply({ embeds: [embed], ephemeral: true });
        } catch (error) {
            console.error('Error fetching applicants:', error);
            await interaction.editReply({ content: 'An error occurred while fetching applicants. Please try again later.', ephemeral: true });
        } finally {
            await pgClient.end();
        }
    },
};