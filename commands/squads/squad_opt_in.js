const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
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

const SPREADSHEET_ID = '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k';

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
                spreadsheetId: SPREADSHEET_ID,
                range: range });

            const allData = allDataResponse.data.values || [];

            let dataRowIndex = -1;
            const userRow = allData.find((row, index) => {
                if (row && row.length > 1 && row[1] === userId.toString()) {
                    dataRowIndex = index;
                    return true;
                }
                return false;
            });

            if (!userRow || dataRowIndex === -1) {
                const errorContainer = new ContainerBuilder();
                const block = buildTextBlock({ title: 'Data Not Found', subtitle: 'Squad Invitations', lines: ['Your data could not be found in the system.', 'If you believe this is an error, please contact an admin.'] });
            if (block) errorContainer.addTextDisplayComponents(block);
                await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer], ephemeral: true });
                return;
            }

            const sheetRowIndex = dataRowIndex + 1;

            const prefIndex = 7;

            if (userRow.length > prefIndex && userRow[prefIndex] === 'TRUE') {
                const infoContainer = new ContainerBuilder();
                const block = buildTextBlock({ title: 'Already Opted In', subtitle: 'Squad Invitations', lines: ['You are already opted in to receive squad invitations.'] });
            if (block) infoContainer.addTextDisplayComponents(block);
                await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [infoContainer], ephemeral: true });
                return;
            }

            const updateRange = `All Data!H${sheetRowIndex}`;
            console.log(`Updating ${updateRange} to TRUE for user ${userId}`);

            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: updateRange,
                valueInputOption: 'RAW',
                requestBody: {
                    values: [['TRUE']]
                }
            }).catch(err => { throw new Error(`Sheet update failed: ${err.message}`); });

            const successContainer = new ContainerBuilder();
            const block = buildTextBlock({ title: 'Opt-In Confirmed', subtitle: 'Squad Invitations', lines: ['You have successfully opted back in to receive squad invitations.'] });
            if (block) successContainer.addTextDisplayComponents(block);
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [successContainer], ephemeral: true });

        } catch (error) {
            console.error(`Error during squad-opt-in command for ${userId}:`, error);

            const errorContainer = new ContainerBuilder();
            const block = buildTextBlock({ title: 'Request Failed', subtitle: 'Squad Invitations', lines: ['An error occurred while processing your request.', 'Please try again later.'] });
            if (block) errorContainer.addTextDisplayComponents(block);
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer], ephemeral: true });
        }
    }
};
