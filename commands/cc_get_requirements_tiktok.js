const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const credentials = require('../resources/secret.json');
const moment = require('moment');

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

const sheets = google.sheets({ version: 'v4', auth: authorize() });
const sheetId = '15P8BKPbO2DQX6yRXmc9gzuL3iLxfu4ef83Jb8Bi8AJk';
const rangeTikTok = 'TikTok!A:I';
const rangeTTData = 'TT NF Data';

async function getUserData(discordId) {
    try {
        console.log(`[getUserData] Fetching data from Google Sheets for user ID: ${discordId}`);

        const [resTikTok, resTTData] = await Promise.all([
            sheets.spreadsheets.values.get({
                spreadsheetId: sheetId,
                range: rangeTikTok,
            }),
            sheets.spreadsheets.values.get({
                spreadsheetId: sheetId,
                range: rangeTTData,
            })
        ]);

        const rowsTikTok = resTikTok.data.values || [];
        const rowsTTData = resTTData.data.values || [];
        console.log(`[getUserData] Data fetched: ${rowsTikTok.length} rows in TikTok, ${rowsTTData.length} rows in ${rangeTTData}.`);

        let userTikTokRow = null;
        for (const row of rowsTikTok) {
            if (row && row.length > 2 && row[2] === discordId) {
                userTikTokRow = row;
                console.log(`[getUserData] Found application row for ${discordId} in TikTok sheet.`);
                break;
            }
        }

        if (!userTikTokRow) {
            console.log(`[getUserData] No application row found for user ID ${discordId} in TikTok sheet.`);
            return null;
        }

        let userTTDataRow = null;
        for (const row of rowsTTData) {
            if (row && row.length > 11 && row[11] === discordId) {
                userTTDataRow = row;
                console.log(`[getUserData] Found performance data row for ${discordId} in ${rangeTTData} sheet.`);
                break;
            }
        }

        if (!userTTDataRow) {
            console.log(`[getUserData] No performance data row found for user ID ${discordId} in ${rangeTTData} sheet (but application exists).`);
        }

        return { userTikTokRow, userTTDataRow };
    } catch (error) {
        console.error(`[getUserData] Error fetching user data from Google Sheets (Sheet: ${rangeTTData}):`, error);
        return null;
    }
}

function getNextMonday() {
    const nextMonday = moment().day(8);
    return nextMonday;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('check-tiktok-account')
        .setDescription('Checks your TikTok application status and 3-week requirement data.'),
    async execute(interaction) {
        const commandName = '/check-tiktok-account';
        console.log(`[${commandName}] Invoked by ${interaction.user.tag} (${interaction.user.id})`);

        try {
            await interaction.deferReply({ ephemeral: true });
            console.log(`[${commandName}] Reply deferred.`);

            const userId = interaction.user.id;
            const userData = await getUserData(userId);

            if (!userData || !userData.userTikTokRow) {
                await interaction.editReply({ content: 'It looks like you haven\'t applied for the TikTok CC program yet, or we couldn\'t find your application record.', ephemeral: true });
                console.log(`[${commandName}] User ${userId} has not applied or application record not found.`);
                return;
            }

            const { userTikTokRow, userTTDataRow } = userData;

            const applicationDateStr = userTikTokRow[3];
            if (!applicationDateStr) {
                console.error(`[${commandName}] Application date missing or empty in cell D for user ${userId} in TikTok sheet row:`, userTikTokRow);
                await interaction.editReply({ content: 'We found your application, but the application date cell appears to be empty in our records. Please contact support.', ephemeral: true });
                return;
            }

            const trimmedDateStr = applicationDateStr.trim();

            const applicationDate = moment(trimmedDateStr, 'M/D/YYYY', true);

            if (!applicationDate.isValid()) {
                console.error(`[${commandName}] Invalid application date format for user ${userId}. Original: '${applicationDateStr}', Trimmed: '${trimmedDateStr}'. Expected M/D/YYYY.`);
                await interaction.editReply({
                    content: `We found your application, but the date stored ('${applicationDateStr}'). Please note that we begin pulling new form data every Sunday, and platform check data is updated on Mondays. If you believe there's an issue with your submission, please contact support to verify the sheet data.`,
                    ephemeral: true
                });
                return;
            }

            const nextCheckDate = getNextMonday();
            const discordFormattedTimestamp = `<t:${nextCheckDate.unix()}:F>`;

            if (!userTTDataRow) {
                const applicationDateString = applicationDate.format('MMMM Do, YYYY');
                const response = `We found your application submitted on **${applicationDateString}**. Your performance data hasn't been processed into our tracking sheet yet. Data is typically updated weekly. Please check back around ${discordFormattedTimestamp} for your stats.`;
                await interaction.editReply({ content: response, ephemeral: true });
                console.log(`[${commandName}] User ${userId} applied on ${applicationDate.format('YYYY-MM-DD')}, but data not found in ${rangeTTData} sheet yet. Advised to check back ${discordFormattedTimestamp}.`);
                return;
            }

            console.log(`[${commandName}] Found application and performance data for user ${userId}. Preparing stats embed from ${rangeTTData}.`);

            const requirements = { posts: 2, likes: 20 };

            const checkRequirements = (postsStr, likesStr) => {
                const posts = parseInt(postsStr, 10) || 0;
                const likes = parseInt(likesStr, 10) || 0;
                const metPosts = posts >= requirements.posts;
                const metLikes = likes >= requirements.likes;
                return { posts, likes, metPosts, metLikes };
            };

            const followersStr = userTTDataRow[15] || 'N/A';
            const week1 = checkRequirements(userTTDataRow[16], userTTDataRow[18]);
            const week2 = checkRequirements(userTTDataRow[20], userTTDataRow[22]);
            const week3 = checkRequirements(userTTDataRow[24], userTTDataRow[26]);

            const generateRequirementMessage = (weekLabel, weekData) => {
                let message = `**${weekLabel}:**\n` +
                    `Posts: \`${weekData.posts}\` | Avg Likes: \`${weekData.likes}\`\n`;
                if (!weekData.metPosts || !weekData.metLikes) {
                    message += '**Missing:** ';
                    const missing = [];
                    if (!weekData.metPosts) missing.push(`Need ≥ ${requirements.posts} posts`);
                    if (!weekData.metLikes) missing.push(`Need ≥ ${requirements.likes} avg likes`);
                    message += missing.join('; ');
                    message += '\n';
                } else {
                    message += '**Requirements Met** ✅\n';
                }
                return message;
            };

            const embed = new EmbedBuilder()
                .setTitle('📊 Your TikTok 3-Week Stats')
                .setColor('#0099ff')
                .setDescription(
                    `**Followers:** ${followersStr}\n\n` +
                    generateRequirementMessage('3 weeks ago', week1) + '\n' +
                    generateRequirementMessage('2 weeks ago', week2) + '\n' +
                    generateRequirementMessage('Last week', week3)
                )
                .setTimestamp()
                .setFooter({ text: 'TikTok CC Requirements Check' });

            await interaction.editReply({ embeds: [embed], ephemeral: false });
            console.log(`[${commandName}] Successfully sent stats embed to user ${userId}.`);

        } catch (error) {
            console.error(`[${commandName}] Error executing command for user ${interaction.user.tag}:`, error);
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: 'An unexpected error occurred while processing your request.', ephemeral: true });
                } else {
                    await interaction.editReply({ content: 'An unexpected error occurred while processing your request.', ephemeral: true });
                }
            } catch (followUpError) {
                console.error(`[${commandName}] Error sending error message to user:`, followUpError);
            }
        }
    },
};