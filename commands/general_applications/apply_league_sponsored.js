require('dotenv').config();
const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { Client } = require('pg');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('apply-sponsored-league')
        .setDescription('Apply to upgrade your league to Sponsored League'),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const clientConfig = {
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            database: process.env.DB_DATABASE_NAME,
            password: process.env.DB_PASSWORD,
            ssl: { rejectUnauthorized: false },
        };  

        const pgClient = new Client(clientConfig);
        await pgClient.connect();

        try {
            const userId = interaction.user.id;
            const res = await pgClient.query(
                'SELECT * FROM "Active Leagues" WHERE owner_id = $1 AND league_type = $2',
                [userId, 'Active']
            );

            if (res.rows.length === 0) {
                await interaction.editReply({
                    content: 'You do not own an Active League. You cannot proceed.',
                    ephemeral: true,
                });
                return;
            }

            const leagueInfo = res.rows[0];

            if (!leagueInfo.league_invite) {
                await interaction.editReply({
                    content: 'Your league does not have an invite link associated with it. Please update your league information.',
                    ephemeral: true,
                });
                return;
            }

            const serverId = leagueInfo.server_id;

            let memberCount = 'Unknown';
            try {
                const guild = await interaction.client.guilds.fetch(serverId);
                if (guild) {
                    memberCount = guild.memberCount || 'Unknown';
                    console.log(`Fetched memberCount from guild: ${memberCount}`);
                }
            } catch (error) {
                console.error('Error fetching guild by server_id:', error);
                memberCount = 'Unknown';
            }

            const channel = await interaction.client.channels.fetch('1298997780303315016');

            const embed = new EmbedBuilder()
                .setTitle('Sponsored League Application')
                .addFields(
                    { name: 'League Name', value: leagueInfo.league_name, inline: true },
                    { name: 'Server Name', value: leagueInfo.server_name, inline: true },
                    { name: 'Owner', value: `<@${userId}>`, inline: true },
                    { name: 'Applied League Level', value: 'Sponsored', inline: true },
                    { name: 'League Invite', value: leagueInfo.league_invite, inline: true },
                    { name: 'Member Count', value: memberCount !== 'Unknown' ? memberCount.toString() : 'Unknown', inline: true },
                )
                .setTimestamp();

            const approveButton = new ButtonBuilder()
                .setCustomId('approveLeague')
                .setLabel('Approve')
                .setStyle(ButtonStyle.Success);

            const denyButton = new ButtonBuilder()
                .setCustomId('denyLeague')
                .setLabel('Deny')
                .setStyle(ButtonStyle.Danger);

            const actionRow = new ActionRowBuilder().addComponents(approveButton, denyButton);

            const applicationMessage = await channel.send({ embeds: [embed], components: [actionRow] });

            await pgClient.query(
                `INSERT INTO "League Applications" 
                (applicant_id, applicant_discord_name, league_name, league_invite, applied_league_level, application_message_id, review_status, application_type, applied_date, member_count) 
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9)`,
                [
                    interaction.user.id,
                    interaction.user.username,
                    leagueInfo.league_name,
                    leagueInfo.league_invite,
                    'Sponsored',
                    applicationMessage.id,
                    'Pending',
                    'League Upgrade',
                    memberCount !== 'Unknown' ? parseInt(memberCount, 10) : null
                ]
            );

            await interaction.editReply({ content: 'Your application has been submitted for review.', ephemeral: true });
        } catch (error) {
            console.error('Error in /apply-sponsored-league command:', error);
            await interaction.editReply({ content: 'An error occurred while processing your application.', ephemeral: true });
        } finally {
            await pgClient.end();
        }
    },
};