const { SlashCommandBuilder, MessageFlags, ContainerBuilder } = require('discord.js');
const { executeQuery } = require('../../db');
const { getSheetsClient } = require('../../utils/sheets_cache');
const { buildTextBlock } = require('../../utils/ui');
const logger = require('../../utils/logger');  

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

        try {
            const queries = [
                executeQuery(
                    'SELECT post_owner_discord_id, discord_thread_id, participants FROM "lfm_data" WHERE post_owner_discord_id = $1 AND discord_thread_id IS NOT NULL',
                    [commandUserId]
                ),
                executeQuery(
                    'SELECT post_owner_discord_id, discord_thread_id, participants FROM lfg_data WHERE post_owner_discord_id = $1 AND discord_thread_id IS NOT NULL',
                    [commandUserId]
                ),
                executeQuery(
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

            await executeQuery(`UPDATE "${lfgSystem}" SET participants = $1 WHERE discord_thread_id = $2`, [
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
            logger.error('Error handling interaction or updating Google Sheet:', error);
            const errorContainer = new ContainerBuilder();
            const block = buildTextBlock({ title: 'Request Failed', subtitle: 'Remove Participant', lines: ['An error occurred while processing your request.'] });
            if (block) errorContainer.addTextDisplayComponents(block);
            await interaction.reply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer], ephemeral: true });
        }
    } };
