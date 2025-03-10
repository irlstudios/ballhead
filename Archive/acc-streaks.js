const { google } = require('googleapis');
const cron = require('node-cron');
const moment = require('moment');
const credentials = require('../resources/secret.json');

const rewardRoles = {
    2: { id: '1273064307663437844', name: '2 Week ACC Streak' },
    5: { id: '1273064456313901139', name: '5 Week ACC Streak' },
    10: { id: '1273064613692309631', name: '10 Week ACC Streak' },
    20: { id: '1273064695862923316', name: '20 Week ACC Streak' },
    30: { id: '1273064759675060347', name: '30 Week ACC Streak' },
    50: { id: '1273064850943115274', name: '50 Week ACC Streak' },
    100: { id: '1273064914176577596', name: '100 Week ACC Streak' }
};

const snowflakeRegex = /^[0-9]{17,19}$/;

function authorize() {
    const { client_email, private_key } = credentials;
    const auth = new google.auth.JWT(
        client_email,
        null,
        private_key,
        ['https://www.googleapis.com/auth/spreadsheets.readonly']
    );
    return auth;
}

async function fetchStreakData(sheetId, sheetTab) {
    console.log('Fetching streak data...');
    const auth = authorize();
    const sheets = google.sheets({ version: 'v4', auth });

    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: sheetId,
            range: `${sheetTab}!B4:ZZ`
        });

        console.log('Data fetched successfully.');
        return response.data.values;
    } catch (error) {
        console.error('Error fetching data from Google Sheets:', error);
        return null;
    }
}

function calculateStreaks(data) {
    const streaks = data.map(row => {
        const username = row[0];
        const discordId = row[1];
        const streakData = row.slice(6);

        let streak = 0;

        for (let i = streakData.length - 1; i >= 0; i--) {
            if (streakData[i] === 'TRUE') {
                streak++;
            } else {
                break;
            }
        }

        return { username, discordId, streak: streak > 0 ? streak : 0 };
    });

    return streaks;
}

async function sendStreakMessages(client, streaks) {
    for (const { username, discordId, streak } of streaks) {
        if (!snowflakeRegex.test(discordId)) {
            console.error(`Invalid Discord ID: ${discordId} for user ${username}`);
            continue;
        }

        try {
            const user = await client.users.fetch(discordId);
            if (!user) {
                console.error(`User not found for ID: ${discordId}`);
                continue;
            }

            if (streak > 0) {
                const guildMember = await client.guilds.cache.get(process.env.Guild_ID).members.fetch(discordId);
                let assignedRole = null;
                let roleName = '';

                for (const [weeks, roleInfo] of Object.entries(rewardRoles).reverse()) {
                    if (streak >= weeks) {
                        assignedRole = roleInfo.id;
                        roleName = roleInfo.name;
                        break;
                    }
                }

                if (assignedRole) {
                    for (const roleId of Object.values(rewardRoles).map(role => role.id)) {
                        if (guildMember.roles.cache.has(roleId) && roleId !== assignedRole) {
                            await guildMember.roles.remove(roleId);
                        }
                    }

                    if (!guildMember.roles.cache.has(assignedRole)) {
                        await guildMember.roles.add(assignedRole);
                    }

                    const messageContent = `🎉 **Congratulations, ${username}!** 🎉\n\nYou’ve reached a ${streak}-week CC Streak and earned the **${roleName}** role! Keep up the amazing work! 💪\n\nStay consistent and aim for your next milestone! 🌟`;
                    await user.send(messageContent);
                } else {
                    const messageContent = `👏 **Great job, ${username}!** 👏\n\nYou successfully met your CC requirements last week, bringing your ACC Streak to **${streak} weeks**! Keep it going!\n\nStay on track, and let's see how far you can go! 🚀`;
                    await user.send(messageContent);
                }
            } else {
                const messageContent = `😔 **Sorry, ${username}** 😔\n\nIt looks like your ACC Streak has been broken.\n\nDon't give up! You can start building your streak again! 💪`;
                await user.send(messageContent);

                const guildMember = await client.guilds.cache.get(process.env.Guild_ID).members.fetch(discordId);
                for (const roleId of Object.values(rewardRoles).map(role => role.id)) {
                    if (guildMember.roles.cache.has(roleId)) {
                        await guildMember.roles.remove(roleId);
                    }
                }
            }
        } catch (error) {
            console.error(`Failed to send message to user ${username} (ID: ${discordId}):`, error);
        }
    }
}

module.exports = {
    name: 'ready',
    once: true,
    async execute(client) {
        console.log('Setting up streaks cron job...');

        cron.schedule('0 22 * * 2', async () => {
            console.log('Running streaks check...');

            const sheetId = '15P8BKPbO2DQX6yRXmc9gzuL3iLxfu4ef83Jb8Bi8AJk';
            const sheetTab = 'Active CC';
            const data = await fetchStreakData(sheetId, sheetTab);

            if (data) {
                const streaks = calculateStreaks(data);
                await sendStreakMessages(client, streaks);
            } else {
                console.error('No data retrieved from Google Sheets.');
            }
        });
    },
};