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

const rangeYouTubeApp = 'YouTube!A:D';
const rangeYTData = 'YT NF Data!O:AP';

async function getUserData(discordId) {
    try {
        console.log(`[YT getUserData] Fetching data from Google Sheets for user ID: ${discordId}`);

        const [resYouTubeApp, resYTData] = await Promise.all([
            sheets.spreadsheets.values.get({
                spreadsheetId: sheetId,
                range: rangeYouTubeApp,
            }),
            sheets.spreadsheets.values.get({
                spreadsheetId: sheetId,
                range: rangeYTData,
            })
        ]);

        const rowsYouTubeApp = resYouTubeApp.data.values || [];
        const rowsYTData = resYTData.data.values || [];
        console.log(`[YT getUserData] Data fetched: ${rowsYouTubeApp.length} rows in ${rangeYouTubeApp}, ${rowsYTData.length} rows in ${rangeYTData}.`);

        let userApplicationRow = null;
        for (const row of rowsYouTubeApp) {
            if (row && row.length > 2 && row[2] === discordId) {
                userApplicationRow = row;
                console.log(`[YT getUserData] Found application row for ${discordId} in ${rangeYouTubeApp} sheet.`);
                break;
            }
        }

        if (!userApplicationRow) {
            console.log(`[YT getUserData] No application row found for user ID ${discordId} in ${rangeYouTubeApp} sheet.`);
            return null;
        }

        let userPerformanceRow = null;
        const discordIdIndexRelative = 1;
        for (let i = 2; i < rowsYTData.length; i++) {
            const row = rowsYTData[i];
            if (row && row.length > discordIdIndexRelative && row[discordIdIndexRelative] === discordId) {
                userPerformanceRow = row;
                console.log(`[YT getUserData] Found performance data row for ${discordId} at sheet row index ${i} in ${rangeYTData} sheet.`);
                break;
            }
        }

        if (!userPerformanceRow) {
            console.log(`[YT getUserData] No performance data row found for user ID ${discordId} in ${rangeYTData} sheet (rows 3+).`);
        }

        return { userApplicationRow, userPerformanceRow };
    } catch (error)
    {
        console.error(`[YT getUserData] Error fetching user data from Google Sheets (Range: ${rangeYTData}):`, error);
        return null;
    }
}

function getNextMonday() {
    return moment().day(8);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('check-youtube-account')
        .setDescription('Checks your YouTube application status and 3-week requirement data.'),
    async execute(interaction) {
        const commandName = '/check-youtube-account';
        console.log(`[${commandName}] Invoked by ${interaction.user.tag} (${interaction.user.id})`);

        try {
            await interaction.deferReply({ ephemeral: true });
            console.log(`[${commandName}] Reply deferred.`);

            const userId = interaction.user.id;
            const userData = await getUserData(userId);

            if (!userData || !userData.userApplicationRow) {
                await interaction.editReply({
                    content: `It looks like you haven't applied for the YouTube CC program yet, or we couldn't find your application record in the \`${rangeYouTubeApp}\` sheet.`,
                    ephemeral: true
                });
                console.log(`[${commandName}] User ${userId} has not applied or application record not found in ${rangeYouTubeApp}.`);
                return;
            }

            const { userApplicationRow, userPerformanceRow } = userData;

            const applicationDateStr = userApplicationRow[3];
            if (!applicationDateStr) {
                console.error(`[${commandName}] Application date missing or empty in cell D for user ${userId} in ${rangeYouTubeApp} sheet row:`, userApplicationRow);
                await interaction.editReply({ content: `We found your application, but the application date cell (Column D) appears to be empty in our records (\`${rangeYouTubeApp}\` sheet). Please contact support.`, ephemeral: true });
                return;
            }

            const trimmedDateStr = applicationDateStr.trim();
            const applicationDate = moment(trimmedDateStr, 'M/D/YYYY', true);
            if (!applicationDate.isValid()) {
                console.error(`[${commandName}] Invalid application date format for user ${userId} in ${rangeYouTubeApp} (Col D). Original: '${applicationDateStr}', Trimmed: '${trimmedDateStr}'. Expected M/D/YYYY.`);
                await interaction.editReply({
                    content: `We found your application, but the date stored ('${applicationDateStr}'). Please note that we begin pulling new form data every Sunday, and platform check data is updated on Mondays. If you believe there's an issue with your submission, please contact support to verify the sheet data.`,
                    ephemeral: true
                });
                return;
            }

            const nextCheckDate = getNextMonday();
            const discordFormattedTimestamp = `<t:${nextCheckDate.unix()}:F}`;

            if (!userPerformanceRow) {
                const applicationDateString = applicationDate.format('MMMM Do, YYYY');
                const response = `We found your application submitted on **${applicationDateString}**. Your performance data wasn't found in the \`${rangeYTData}\` tracking sheet (rows 3+). Data is typically updated weekly. Please check back around ${discordFormattedTimestamp}.`;
                await interaction.editReply({ content: response, ephemeral: true });
                console.log(`[${commandName}] User ${userId} applied on ${applicationDate.format('YYYY-MM-DD')}, but data not found in ${rangeYTData} sheet (rows 3+). Advised to check back ${discordFormattedTimestamp}.`);
                return;
            }

            console.log(`[${commandName}] Found application and performance data for user ${userId}. Preparing stats embed from ${rangeYTData}.`);

            const requirements = {
                posts: 2,
                likes: 15
            };
            const postsLabel = "Videos";
            const likesLabel = "Avg Views/Likes";

            const checkRequirements = (postsStr, likesStr) => {
                const posts = parseInt(postsStr, 10) || 0;
                const likes = parseInt(likesStr, 10) || 0;
                const metPosts = posts >= requirements.posts;
                const metLikes = likes >= requirements.likes;
                return { posts, likes, metPosts, metLikes };
            };

            const subscribersStr = userPerformanceRow[5] || 'N/A';
            const week1 = checkRequirements(userPerformanceRow[6], userPerformanceRow[8]);
            const week2 = checkRequirements(userPerformanceRow[12], userPerformanceRow[14]);
            const week3 = checkRequirements(userPerformanceRow[18], userPerformanceRow[20]);

            const generateRequirementMessage = (weekLabel, weekData) => {
                let message = `**${weekLabel}:**\n` +
                    `${postsLabel}: \`${weekData.posts}\` | ${likesLabel}: \`${weekData.likes}\`\n`;
                if (!weekData.metPosts || !weekData.metLikes) {
                    message += '**Missing:** ';
                    const missing = [];
                    if (!weekData.metPosts) missing.push(`Need ≥ ${requirements.posts} ${postsLabel}`);
                    if (!weekData.metLikes) missing.push(`Need ≥ ${requirements.likes} ${likesLabel}`);
                    message += missing.join('; ');
                    message += '\n';
                } else {
                    message += '**Requirements Met** ✅\n';
                }
                return message;
            };

            const embed = new EmbedBuilder()
                .setTitle('📊 Your YouTube 3-Week Stats')
                .setColor('#FF0000')
                .setDescription(
                    `**Subscribers:** ${subscribersStr}\n\n` +
                    generateRequirementMessage('3 weeks ago', week1) + '\n' +
                    generateRequirementMessage('2 weeks ago', week2) + '\n' +
                    generateRequirementMessage('Last week', week3)
                )
                .setTimestamp()
                .setFooter({ text: 'YouTube CC Requirements Check' });

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