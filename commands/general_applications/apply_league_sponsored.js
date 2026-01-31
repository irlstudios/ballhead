require('dotenv').config();
const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const { Client } = require('pg');

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

function buildNoticeContainer({ title, subtitle, lines}) {
    const container = new ContainerBuilder();
    const block = buildTextBlock({ title, subtitle, lines });
            if (block) container.addTextDisplayComponents(block);
    return container;
}

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
            ssl: { rejectUnauthorized: false } };  

        const pgClient = new Client(clientConfig);
        await pgClient.connect();

        try {
            const userId = interaction.user.id;
            const res = await pgClient.query(
                'SELECT * FROM "Active Leagues" WHERE owner_id = $1 AND league_type = $2',
                [userId, 'Active']
            );

            if (res.rows.length === 0) {
                const errorContainer = buildNoticeContainer({
                    title: 'Active League Required',
                    subtitle: 'Sponsored League Application',
                    lines: ['You do not own an Active League. You cannot proceed.']
                });
                await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer], ephemeral: true });
                return;
            }

            const leagueInfo = res.rows[0];

            if (!leagueInfo.league_invite) {
                const errorContainer = buildNoticeContainer({
                    title: 'Invite Link Missing',
                    subtitle: 'Sponsored League Application',
                    lines: ['Your league does not have an invite link associated with it.', 'Please update your league information.']
                });
                await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer], ephemeral: true });
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

            const applicationContainer = new ContainerBuilder();
            const block = buildTextBlock({ title: 'Sponsored League Application',
                subtitle: leagueInfo.league_name, lines: [
                `**Server Name:** ${leagueInfo.server_name}`,
                `**Owner:** <@${userId}>`,
                '**Applied League Level:** Sponsored',
                `**League Invite:** ${leagueInfo.league_invite}`,
                `**Member Count:** ${memberCount !== 'Unknown' ? memberCount.toString() : 'Unknown'}`
            ] });
            if (block) applicationContainer.addTextDisplayComponents(block);

            const approveButton = new ButtonBuilder()
                .setCustomId('approveLeague')
                .setLabel('Approve')
                .setStyle(ButtonStyle.Success);

            const denyButton = new ButtonBuilder()
                .setCustomId('denyLeague')
                .setLabel('Deny')
                .setStyle(ButtonStyle.Danger);

            const actionRow = new ActionRowBuilder().addComponents(approveButton, denyButton);

            const applicationMessage = await channel.send({
                flags: MessageFlags.IsComponentsV2,
                components: [applicationContainer, actionRow]
            });

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

            const successContainer = buildNoticeContainer({
                title: 'Application Submitted',
                subtitle: 'Sponsored League Application',
                lines: ['Your application has been submitted for review.']
            });
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [successContainer], ephemeral: true });
        } catch (error) {
            console.error('Error in /apply-sponsored-league command:', error);
            const errorContainer = buildNoticeContainer({
                title: 'Application Failed',
                subtitle: 'Sponsored League Application',
                lines: ['An error occurred while processing your application.']
            });
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer], ephemeral: true });
        } finally {
            await pgClient.end();
        }
    } };
