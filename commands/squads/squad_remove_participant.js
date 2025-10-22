const { SlashCommandBuilder } = require('discord.js');
const { google } = require('googleapis');
const { Client } = require('pg');
const credentials = require('../../resources/secret.json');

const clientConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    database: process.env.DB_DATABASE_NAME,
    password: process.env.DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
};  

function authorize() {
    const { client_email, private_key } = credentials;
    const auth = new google.auth.JWT(
        client_email,
        null,
        private_key,
        ['https://www.googleapis.com/auth/spreadsheets']
    );
    return auth;
}

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
                return interaction.reply({ content: 'You do not have any active posts.', ephemeral: true });
            }

            const { discord_thread_id: threadId, participants } = postDetails;

            if (!participants.includes(user.id)) {
                return interaction.reply({
                    content: `<@${user.id}> is not a participant in your post.`,
                    ephemeral: true
                });
            }

            const thread = interaction.guild.channels.cache.get(threadId);
            if (!thread) {
                return interaction.reply({ content: 'The post thread could not be found.', ephemeral: true });
            }

            await thread.members.remove(user.id);

            const updatedParticipants = participants.filter(participant => participant !== user.id);

            await client.query(`UPDATE "${lfgSystem}" SET participants = $1 WHERE discord_thread_id = $2`, [
                updatedParticipants,
                threadId,
            ]);

            if (lfgSystem === 'lfo_data') {
                const sheets = google.sheets({ version: 'v4', auth: authorize() });

                const sheetData = await sheets.spreadsheets.values.get({
                    spreadsheetId: sheetId,
                    range: `${sheetTabName}!A:E`,
                });

                const rows = sheetData.data.values || [];
                const userRowIndex = rows.findIndex(row => row[1] === user.id);

                if (userRowIndex !== -1) {
                    await sheets.spreadsheets.values.update({
                        spreadsheetId: sheetId,
                        range: `${sheetTabName}!E${userRowIndex + 1}`,
                        valueInputOption: 'USER_ENTERED',
                        requestBody: {
                            values: [['TRUE']],
                        },
                    });
                }
            }

            await interaction.reply({
                content: `<@${user.id}> has been removed from your post`,
                ephemeral: true,
            });
        } catch (error) {
            console.error('Error handling interaction or updating Google Sheet:', error);
            await interaction.reply({ content: 'An error occurred while processing your request.', ephemeral: true });
        } finally {
            await client.end();
        }
    },
};
