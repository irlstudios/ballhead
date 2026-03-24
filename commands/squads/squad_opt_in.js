const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const { getSheetsClient } = require('../../utils/sheets_cache');
const { SPREADSHEET_SQUADS } = require('../../config/constants');
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
        .setName('squad-opt-in')
        .setDescription('Opt back into receiving squad invitations.'),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const userId = interaction.user.id;
        const sheets = await getSheetsClient();

        try {
            const range = 'All Data!A:H';
            const allDataResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_SQUADS,
                range: range });

            const allData = allDataResponse.data.values || [];

            const prefIndex = 7;
            const userRowIndices = [];
            for (let i = 0; i < allData.length; i++) {
                const row = allData[i];
                if (row && row.length > 1 && row[1] === userId.toString()) {
                    userRowIndices.push(i);
                }
            }

            if (userRowIndices.length === 0) {
                const errorContainer = new ContainerBuilder();
                const block = buildTextBlock({ title: 'Data Not Found', subtitle: 'Squad Invitations', lines: ['Your data could not be found in the system.', 'If you believe this is an error, please contact an admin.'] });
                if (block) errorContainer.addTextDisplayComponents(block);
                await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer], ephemeral: true });
                return;
            }

            const firstRow = allData[userRowIndices[0]];
            if (firstRow.length > prefIndex && firstRow[prefIndex] === 'TRUE') {
                const infoContainer = new ContainerBuilder();
                const block = buildTextBlock({ title: 'Already Opted In', subtitle: 'Squad Invitations', lines: ['You are already opted in to receive squad invitations.'] });
                if (block) infoContainer.addTextDisplayComponents(block);
                await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [infoContainer], ephemeral: true });
                return;
            }

            const updatePromises = userRowIndices.map(idx => {
                const sheetRow = idx + 1;
                const updateRange = `All Data!H${sheetRow}`;
                logger.info(`Updating ${updateRange} to TRUE for user ${userId}`);
                return sheets.spreadsheets.values.update({
                    spreadsheetId: SPREADSHEET_SQUADS,
                    range: updateRange,
                    valueInputOption: 'RAW',
                    requestBody: { values: [['TRUE']] },
                });
            });
            await Promise.all(updatePromises).catch(err => { throw new Error(`Sheet update failed: ${err.message}`); });

            const successContainer = new ContainerBuilder();
            const block = buildTextBlock({ title: 'Opt-In Confirmed', subtitle: 'Squad Invitations', lines: ['You have successfully opted back in to receive squad invitations.'] });
            if (block) successContainer.addTextDisplayComponents(block);
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [successContainer], ephemeral: true });

        } catch (error) {
            logger.error(`Error during squad-opt-in command for ${userId}:`, error);

            const errorContainer = new ContainerBuilder();
            const block = buildTextBlock({ title: 'Request Failed', subtitle: 'Squad Invitations', lines: ['An error occurred while processing your request.', 'Please try again later.'] });
            if (block) errorContainer.addTextDisplayComponents(block);
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer], ephemeral: true });
        }
    }
};
