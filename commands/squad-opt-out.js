const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const axios = require('axios');

const sheets = google.sheets('v4');
const auth = new google.auth.GoogleAuth({
    keyFile: 'resources/secret.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const LOGGING_CHANNEL_ID = '1233853458092658749';
const LOGGING_GUILD_ID = '1233740086839869501';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('squad-opt-out')
        .setDescription('Opt out of receiving squad invitations.'),
    async execute(interaction) {
        const userId = interaction.user.id;
        const updatePreference = async (userID) => {
            const client = await auth.getClient();
            const spreadsheetId = '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k';
            const range = 'All Data!A:F';

            try {
                const response = await sheets.spreadsheets.values.get({
                    auth: client,
                    spreadsheetId,
                    range,
                });

                const rows = response.data.values || [];
                const userRow = rows.find(row => row[1] === userID.toString());

                if (userRow) {
                    const prefIndex = 5;
                    if (userRow[prefIndex] === 'FALSE') {
                        return {success: false, message: "You are already opted out of squad invites."};
                    } else {
                        userRow[prefIndex] = 'FALSE';
                        const rowIndex = rows.indexOf(userRow) + 1;
                        await sheets.spreadsheets.values.update({
                            auth: client,
                            spreadsheetId,
                            range: `All Data!F${rowIndex}`,
                            valueInputOption: 'USER_ENTERED',
                            requestBody: {
                                values: [[userRow[prefIndex]]],
                            },
                        });
                        return {success: true, message: 'You have successfully opted out of squad invites.'};
                    }
                } else {
                    await sheets.spreadsheets.values.append({
                        auth: client,
                        spreadsheetId,
                        range: 'All Data!A:F',
                        valueInputOption: 'USER_ENTERED',
                        requestBody: {
                            values: [[interaction.user.username, userID, 'N/A', 'No', 'FALSE']],
                        },
                    });
                    return {
                        success: true,
                        message: 'You have been added to the database and opted out of squad invites. You can always revert this change with `/squad-opt-in`.'
                    };
                }
            } catch (error) {
                console.error('The API returned an error:', error);
                throw new Error('An error occurred while accessing the sheet.');
            }
        };

        try {
            const result = await updatePreference(userId);
            await interaction.reply({content: result.message, ephemeral: true});
        } catch (error) {
            console.error('Error:', error);
            try {
                const loggingGuild = await interaction.client.guilds.fetch(LOGGING_GUILD_ID);
                const loggingChannel = await loggingGuild.channels.fetch(LOGGING_CHANNEL_ID);
                const errorEmbed = new EmbedBuilder()
                    .setTitle('Error')
                    .setDescription(`An error occurred while processing the \`squad-opt-out\` command: ${error.message}`)
                    .setColor('#FF0000')
                    .setTimestamp();
                await loggingChannel.send({embeds: [errorEmbed]});
            } catch (logError) {
                console.error('Failed to log error:', logError);
            }

            await interaction.reply({
                content: 'An error occurred while processing your request. Please try again later.',
                ephemeral: true
            });
        }
    }
};
