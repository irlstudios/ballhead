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
const rangeTikTok = 'TikTok!A:D';
const rangeTTData = 'TT NF Data';

async function getUserData(discordId) {
    try {
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

        let userTikTokRow = null;
        for (const row of rowsTikTok) {
            if (row && row.length > 2 && row[2] === discordId) {
                userTikTokRow = row;
                break;
            }
        }

        if (!userTikTokRow) {
            return null;
        }

        let userTTDataRow = null;
        for (const row of rowsTTData) {
            if (row && row.length > 12 && row[12] === discordId) {
                userTTDataRow = row;
                break;
            }
        }

        return { userTikTokRow, userTTDataRow };
    } catch {
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
        try {
            if (process.env.ALLOW_CC_REQUIREMENTS_TIKTOK !== 'true') {
                await interaction.reply({ content: 'The program is currently undergoing changes and cannot display any data at the moment. Please check back soon.', ephemeral: true });
                return;
            }
            await interaction.deferReply({ ephemeral: true });
            const userId = interaction.user.id;
            const userData = await getUserData(userId);
            if (!userData || !userData.userTikTokRow) {
                await interaction.editReply({ content: 'It looks like you haven\'t applied for the TikTok CC program yet, or we couldn\'t find your application record.', ephemeral: true });
                return;
            }
            const { userTikTokRow, userTTDataRow } = userData;
            const applicationDateStr = userTikTokRow[3];
            if (!applicationDateStr) {
                await interaction.editReply({ content: 'We found your application, but the application date cell appears to be empty in our records. Please contact support.', ephemeral: true });
                return;
            }
            const trimmedDate = applicationDateStr.split(',')[0].trim();
            const applicationDate = moment(trimmedDate, 'M/D/YYYY', true);
            if (!applicationDate.isValid()) {
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
                return;
            }

            const requirements = { posts: 2, likes: 20 };

            const checkRequirements = (postsStr, likesStr) => {
                const posts = parseInt(postsStr, 10) || 0;
                const likes = parseInt(likesStr, 10) || 0;
                const metPosts = posts >= requirements.posts;
                const metLikes = likes >= requirements.likes;
                return { posts, likes, metPosts, metLikes };
            };

            const followersStr = userTTDataRow[16] || 'N/A';

            const week1Data = {
                ...checkRequirements(userTTDataRow[17], userTTDataRow[19]),
                quality: userTTDataRow[20] || 'N/A'
            };
            const week2Data = {
                ...checkRequirements(userTTDataRow[22], userTTDataRow[24]),
                quality: userTTDataRow[25] || 'N/A'
            };
            const week3Data = {
                ...checkRequirements(userTTDataRow[27], userTTDataRow[29]),
                quality: userTTDataRow[30] || 'N/A'
            };

            const generateRequirementMessage = (weekLabel, data) => {
                let message = `**${weekLabel}:**\nPosts: \`${data.posts}\` | Avg Likes: \`${data.likes}\` | Avg Quality: \`${data.quality}\`\n`;
                if (!data.metPosts || !data.metLikes) {
                    const missing = [];
                    if (!data.metPosts) missing.push(`Need ≥ ${requirements.posts} posts`);
                    if (!data.metLikes) missing.push(`Need ≥ ${requirements.likes} avg likes`);
                    message += '**Missing:** ' + missing.join('; ') + '\n';
                } else {
                    message += '**Requirements Met** ✅\n';
                }
                return message;
            };

            const embed = new EmbedBuilder()
                .setTitle('📊 Your TikTok 3‑Week Stats')
                .setColor('#0099ff')
                .setDescription(
                    `**Followers:** ${followersStr}\n\n` +
                    generateRequirementMessage('3 weeks ago', week1Data) + '\n' +
                    generateRequirementMessage('2 weeks ago', week2Data) + '\n' +
                    generateRequirementMessage('Last week', week3Data)
                )
                .setTimestamp()
                .setFooter({ text: 'TikTok CC Requirements Check' });

            await interaction.editReply({ embeds: [embed], ephemeral: false });
        } catch (error) {
            console.error('Error while processing TikTok requirements:', error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: 'An unexpected error occurred while processing your request.', ephemeral: true });
            } else {
                await interaction.editReply({ content: 'An unexpected error occurred while processing your request.', ephemeral: true });
            }
        }
    },
};
