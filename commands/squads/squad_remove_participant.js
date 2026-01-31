const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const { Client } = require('pg');
const { getSheetsClient } = require('../../utils/sheets_cache');

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

const clientConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    database: process.env.DB_DATABASE_NAME,
    password: process.env.DB_PASSWORD,
    ssl: { rejectUnauthorized: false } };  

module.exports = {
    data: new SlashCommandBuilder()
        .setName('remove-participant')
        .setDescription('Remove a participant from a LFG Post')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to remove from the post')
                .setRequired(true)
        ),
    async execute(interaction) {
        const user = interaction.options.getUser('user');
        const commandUserId = interaction.user.id;

        const sheetId = '14J4LOdWDa2mzS6HzVBzAJgfnfi8_va1qOWVsxnwB-UM';
        const sheetTabName = 'Officials LFO Interactions';

        const client = new Client(clientConfig);
        await client.connect();

        try {
            const queries = [
                client.query(
                    'SELECT post_owner_discord_id, discord_thread_id, participants FROM "lfm_data" WHERE post_owner_discord_id = $1 AND discord_thread_id IS NOT NULL',
                    [commandUserId]
                ),
                client.query(
                    'SELECT post_owner_discord_id, discord_thread_id, participants FROM lfg_data WHERE post_owner_discord_id = $1 AND discord_thread_id IS NOT NULL',
                    [commandUserId]
                ),
                client.query(
                    'SELECT post_owner_discord_id, discord_thread_id, participants FROM lfo_data WHERE post_owner_discord_id = $1 AND discord_thread_id IS NOT NULL',
                    [commandUserId]
                )
            ];

            let postDetails = null;
            let lfgSystem = '';

            for (let i = 0; i < queries.length; i++) {
                const result = await queries[i];
                if (result.rows.length > 0) {
                    postDetails = result.rows[0];
                    lfgSystem = ['lfm_data', 'lfg_data', 'lfo_data'][i];
                    break;
                }
            }

            if (!postDetails) {
                const errorContainer = new ContainerBuilder();
                const block = buildTextBlock({ title: 'No Active Post', subtitle: 'Remove Participant', lines: ['You do not have any active posts.'] });
            if (block) errorContainer.addTextDisplayComponents(block);
                return interaction.reply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer], ephemeral: true });
            }

            const { discord_thread_id: threadId, participants } = postDetails;

            if (!participants.includes(user.id)) {
                const errorContainer = new ContainerBuilder();
                const block = buildTextBlock({ title: 'Participant Not Found', subtitle: 'Remove Participant', lines: [`<@${user.id}> is not a participant in your post.`] });
            if (block) errorContainer.addTextDisplayComponents(block);
                return interaction.reply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer], ephemeral: true });
            }

            const thread = interaction.guild.channels.cache.get(threadId);
            if (!thread) {
                const errorContainer = new ContainerBuilder();
                const block = buildTextBlock({ title: 'Thread Not Found', subtitle: 'Remove Participant', lines: ['The post thread could not be found.'] });
            if (block) errorContainer.addTextDisplayComponents(block);
                return interaction.reply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer], ephemeral: true });
            }

            await thread.members.remove(user.id);

            const updatedParticipants = participants.filter(participant => participant !== user.id);

            await client.query(`UPDATE "${lfgSystem}" SET participants = $1 WHERE discord_thread_id = $2`, [
                updatedParticipants,
                threadId,
            ]);

            if (lfgSystem === 'lfo_data') {
                const sheets = await getSheetsClient();

                const sheetData = await sheets.spreadsheets.values.get({
                    spreadsheetId: sheetId,
                    range: `${sheetTabName}!A:E` });

                const rows = sheetData.data.values || [];
                const userRowIndex = rows.findIndex(row => row[1] === user.id);

                if (userRowIndex !== -1) {
                    await sheets.spreadsheets.values.update({
                        spreadsheetId: sheetId,
                        range: `${sheetTabName}!E${userRowIndex + 1}`,
                        valueInputOption: 'USER_ENTERED',
                        requestBody: {
                            values: [['TRUE']] } });
                }
            }

            const successContainer = new ContainerBuilder();
            const block = buildTextBlock({ title: 'Participant Removed', subtitle: 'Remove Participant', lines: [`<@${user.id}> has been removed from your post.`] });
            if (block) successContainer.addTextDisplayComponents(block);
            await interaction.reply({
                flags: MessageFlags.IsComponentsV2,
                components: [successContainer],
                ephemeral: true
            });
        } catch (error) {
            console.error('Error handling interaction or updating Google Sheet:', error);
            const errorContainer = new ContainerBuilder();
            const block = buildTextBlock({ title: 'Request Failed', subtitle: 'Remove Participant', lines: ['An error occurred while processing your request.'] });
            if (block) errorContainer.addTextDisplayComponents(block);
            await interaction.reply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer], ephemeral: true });
        } finally {
            await client.end();
        }
    } };
