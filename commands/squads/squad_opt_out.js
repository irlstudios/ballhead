const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const { getSheetsClient } = require('../../utils/sheets_cache');
const { SPREADSHEET_SQUADS, BALLHEAD_GUILD_ID, BOT_BUGS_CHANNEL_ID } = require('../../config/constants');
const logger = require('../../utils/logger');

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

module.exports = {
    data: new SlashCommandBuilder()
        .setName('squad-opt-out')
        .setDescription('Opt out of receiving squad invitations.'),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const userId = interaction.user.id;
        const username = interaction.user.username;

        const updatePreference = async (userID, currentUsername) => {
            const sheets = await getSheetsClient();
            const range = 'All Data!A:H';

            try {
                const response = await sheets.spreadsheets.values.get({
                    spreadsheetId: SPREADSHEET_SQUADS,
                    range });

                const rows = response.data.values || [];
                const prefIndex = 7;
                const userRowIndices = [];
                for (let i = 0; i < rows.length; i++) {
                    const row = rows[i];
                    if (row && row.length > 1 && row[1] === userID.toString()) {
                        userRowIndices.push(i);
                    }
                }

                if (userRowIndices.length > 0) {
                    const firstRow = rows[userRowIndices[0]];

                    if (firstRow.length > prefIndex && firstRow[prefIndex] === 'FALSE') {
                        return { success: false, message: 'You are already opted out of squad invites.' };
                    } else {
                        const updatePromises = userRowIndices.map(idx => {
                            const sheetRow = idx + 1;
                            const updateRange = `All Data!H${sheetRow}`;
                            logger.info(`Updating ${updateRange} to FALSE for user ${userID}`);
                            return sheets.spreadsheets.values.update({
                                spreadsheetId: SPREADSHEET_SQUADS,
                                range: updateRange,
                                valueInputOption: 'RAW',
                                requestBody: { values: [['FALSE']] },
                            });
                        });
                        await Promise.all(updatePromises).catch(err => { throw new Error(`Sheet update failed: ${err.message}`); });
                        return { success: true, message: 'You have successfully opted out of squad invites.' };
                    }
                } else {
                    logger.info(`User ${userID} not found in All Data, appending new row.`);
                    const newRowData = [
                        currentUsername,
                        userID.toString(),
                        'N/A',
                        'N/A',
                        'N/A',
                        'FALSE',
                        'No',
                        'FALSE'
                    ];
                    await sheets.spreadsheets.values.append({
                        spreadsheetId: SPREADSHEET_SQUADS,
                        range: 'All Data!A1',
                        valueInputOption: 'RAW',
                        requestBody: {
                            values: [newRowData] } }).catch(err => { throw new Error(`Sheet append failed: ${err.message}`); });
                    return {
                        success: true,
                        message: 'You have been added to the database and opted out of squad invites. You can always revert this change with `/squad-opt-in`.'
                    };
                }
            } catch (error) {
                logger.error('The API returned an error:', error);
                if (error.message.startsWith('Sheet')) {
                    throw error;
                } else {
                    throw new Error('An error occurred while accessing the sheet.');
                }
            }
        };

        try {
            const result = await updatePreference(userId, username);
            const infoContainer = new ContainerBuilder();
            const block = buildTextBlock({ title: result.success ? 'Preference Updated' : 'Already Opted Out',
                subtitle: 'Squad Invitations', lines: [result.message] });
            if (block) infoContainer.addTextDisplayComponents(block);
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [infoContainer], ephemeral: true });
        } catch (error) {
            logger.error(`Error in /squad-opt-out for ${userId}:`, error);
            try {
                const loggingGuild = await interaction.client.guilds.fetch(BALLHEAD_GUILD_ID);
                const loggingChannel = await loggingGuild.channels.fetch(BOT_BUGS_CHANNEL_ID);
                const errorContainer = new ContainerBuilder();
                const block = buildTextBlock({ title: 'Squad Opt-Out Error', subtitle: 'Command Failure', lines: [`**User:** ${interaction.user.tag} (${userId })`, `**Error:** ${error.message}`] });
            if (block) errorContainer.addTextDisplayComponents(block);
                await loggingChannel.send({ flags: MessageFlags.IsComponentsV2, components: [errorContainer] });
            } catch (logError) {
                logger.error('Failed to log error to Discord:', logError);
            }

            const replyContainer = new ContainerBuilder();
            const block = buildTextBlock({ title: 'Request Failed', subtitle: 'Squad Invitations', lines: ['An error occurred while processing your request.', 'The team has been notified.'] });
            if (block) replyContainer.addTextDisplayComponents(block);
            await interaction.editReply({
                flags: MessageFlags.IsComponentsV2,
                components: [replyContainer],
                ephemeral: true
            }).catch(logger.error);
        }
    }
};
