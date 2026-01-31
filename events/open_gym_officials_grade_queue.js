const { schedule } = require('node-cron');
const { MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const { getSheetsClient } = require('../utils/sheets_cache');

const SHEET_ID = '14J4LOdWDa2mzS6HzVBzAJgfnfi8_va1qOWVsxnwB-UM';
const SHEET_TAB_NAME = 'Form Responses 1';
const CHANNEL_ID = '1285164801911427072';

async function fetchUngradedVideoCount() {
    const sheets = await getSheetsClient();
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
            const container = new ContainerBuilder();
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent('## Ungraded Video Queue'));
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`There are currently **${ungradedCount}** videos waiting for grading.`));

            await channel.send({ flags: MessageFlags.IsComponentsV2, components: [container] });
        }

        if (ungradedCount < 100) {
            const alertContainer = new ContainerBuilder();
            alertContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent('## Grading Catch-Up Needed'));
            alertContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent('Hey <@&> please ensure to catch up on posts that are missing grades.'));
            await channel.send({ flags: MessageFlags.IsComponentsV2, components: [alertContainer] });
        }
    } catch (error) {
        console.error('Error posting ungraded video count:', error);
    }
}

module.exports = {
    name: 'clientReady',
    execute(client) {
        schedule('0 */2 * * *', async () => {
            await postUngradedVideoCount(client);
        });
    },
};
