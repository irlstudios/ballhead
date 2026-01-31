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
const LOGGING_CHANNEL_ID = '1233853458092658749';
const LOGGING_GUILD_ID = '1233740086839869501';

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
                    spreadsheetId: SPREADSHEET_ID,
                    range });

                const rows = response.data.values || [];
                let rowIndex = -1;
                const userRow = rows.find((row, index) => {
                    if (row && row.length > 1 && row[1] === userID.toString()) {
                        rowIndex = index + 1;
                        return true;
                    }
                    return false;
                });


                if (userRow && rowIndex > 0) {
                    const prefIndex = 7;

                    if (userRow.length > prefIndex && userRow[prefIndex] === 'FALSE') {
                        return { success: false, message: 'You are already opted out of squad invites.' };
                    } else {
                        const updateRange = `All Data!H${rowIndex}`;
                        console.log(`Updating ${updateRange} to FALSE for user ${userID}`);
                        await sheets.spreadsheets.values.update({
                            spreadsheetId: SPREADSHEET_ID,
                            range: updateRange,
                            valueInputOption: 'RAW',
                            requestBody: {
                                values: [['FALSE']] } }).catch(err => { throw new Error(`Sheet update failed: ${err.message}`); });
                        return { success: true, message: 'You have successfully opted out of squad invites.' };
                    }
                } else {
                    console.log(`User ${userID} not found in All Data, appending new row.`);
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
                        spreadsheetId: SPREADSHEET_ID,
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
                console.error('The API returned an error:', error);
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
            console.error(`Error in /squad-opt-out for ${userId}:`, error);
            try {
                const loggingGuild = await interaction.client.guilds.fetch(LOGGING_GUILD_ID);
                const loggingChannel = await loggingGuild.channels.fetch(LOGGING_CHANNEL_ID);
                const errorContainer = new ContainerBuilder();
                const block = buildTextBlock({ title: 'Squad Opt-Out Error', subtitle: 'Command Failure', lines: [`**User:** ${interaction.user.tag} (${userId })`, `**Error:** ${error.message}`] });
            if (block) errorContainer.addTextDisplayComponents(block);
                await loggingChannel.send({ flags: MessageFlags.IsComponentsV2, components: [errorContainer] });
            } catch (logError) {
                console.error('Failed to log error to Discord:', logError);
            }

            const replyContainer = new ContainerBuilder();
            const block = buildTextBlock({ title: 'Request Failed', subtitle: 'Squad Invitations', lines: ['An error occurred while processing your request.', 'The team has been notified.'] });
            if (block) replyContainer.addTextDisplayComponents(block);
            await interaction.editReply({
                flags: MessageFlags.IsComponentsV2,
                components: [replyContainer],
                ephemeral: true
            }).catch(console.error);
        }
    }
};
