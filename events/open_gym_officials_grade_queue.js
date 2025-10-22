const { schedule } = require('node-cron');
const { google } = require('googleapis');
const { EmbedBuilder } = require('discord.js');
const credentials = require('../resources/secret.json');

const SHEET_ID = '14J4LOdWDa2mzS6HzVBzAJgfnfi8_va1qOWVsxnwB-UM';
const SHEET_TAB_NAME = 'Form Responses 1';
const CHANNEL_ID = '1285164801911427072';

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

async function fetchUngradedVideoCount() {
    const auth = authorize();
    const sheets = google.sheets({ version: 'v4', auth });
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_TAB_NAME}!A:J`,
    });

    const rows = response.data.values;

    if (!rows || rows.length === 0) {
        return 0;
    }

    const dataRows = rows.slice(1);

    const ungradedVideos = dataRows.filter(row => {
        const score = row[9]?.trim();
        return !score || isNaN(Number(score));
    });

    return ungradedVideos.length;
}

async function postUngradedVideoCount(client) {
    try {
        const ungradedCount = await fetchUngradedVideoCount();
        const channel = await client.channels.fetch(CHANNEL_ID);

        if (!channel) {
            return;
        }

        if (ungradedCount > 0) {
            const embed = new EmbedBuilder()
                .setTitle('Ungraded Video Count')
                .setDescription(`There are currently **${ungradedCount}** videos in the queue waiting for grading.`)
                .setColor(0x00FF00)
                .setTimestamp();

            await channel.send({embeds: [embed]});
        }

        if (ungradedCount < 100) {
            let alert = 'Hey <@&> please ensure to catch up on posts that are missing grades';
            await channel.send(alert);
        }
    } catch (error) {
        console.error('Error posting ungraded video count:', error);
    }
}

module.exports = {
    name: 'ready',
    execute(client) {
        schedule('0 */2 * * *', async () => {
            await postUngradedVideoCount(client);
        });
    },
};
