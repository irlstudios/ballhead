const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const credentials = require('../../resources/secret.json');
const moment = require('moment');

function authorize() {
    const { client_email, private_key } = credentials;
    return new google.auth.JWT(client_email, null, private_key, ['https://www.googleapis.com/auth/spreadsheets']);
}

const sheets = google.sheets({ version: 'v4', auth: authorize() });
const sheetId = '15P8BKPbO2DQX6yRXmc9gzuL3iLxfu4ef83Jb8Bi8AJk';
const rangeReels = 'Reels!A:D';
const rangeIGData = 'IG NF Data!K:AF';

async function getUserData(discordId) {
    try {
        const [resReels, resIGData] = await Promise.all([
            sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: rangeReels }),
            sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: rangeIGData })
        ]);
        const rowsReels = resReels.data.values || [];
        const rowsIGData = resIGData.data.values || [];

        let userReelsRow = null;
        for (const row of rowsReels) {
            if (row && row.length > 2 && row[2] && row[2].toString().trim() === discordId.toString().trim()) {
                userReelsRow = row;
                break;
            }
        }
        if (!userReelsRow) return null;

        let userIGDataRow = null;
        for (let i = 2; i < rowsIGData.length; i++) {
            const row = rowsIGData[i];
            if (row && row.length > 2 && row[2] === discordId) {
                userIGDataRow = row;
                break;
            }
        }
        return { userReelsRow, userIGDataRow };
    } catch {
        return null;
    }
}

function getNextMonday() {
    return moment().day(8);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('check-reels-account')
        .setDescription('Checks your Instagram application status and 3‑week requirement data.'),
    async execute(interaction) {
        try {
            if (process.env.ALLOW_CC_REQUIREMENTS_REELS !== 'true') {
                await interaction.reply({ content: 'The program is currently undergoing changes and cannot display any data at the moment. Please check back soon.', ephemeral: true });
                return;
            }
            await interaction.deferReply({ ephemeral: true });
            const userId = interaction.user.id;
            const userData = await getUserData(userId);
            if (!userData || !userData.userReelsRow) {
                await interaction.editReply({ content: 'I couldn’t find an Instagram Reels CC application for you. If you’ve already applied, give us a little time to process it—or submit the form and try again.', ephemeral: true });
                return;
            }
            const { userReelsRow, userIGDataRow } = userData;
            const applicationDateStr = userReelsRow[3];
            if (!applicationDateStr) {
                await interaction.editReply({ content: 'We found your application, but the submission date is missing on our end. Please reach out to support so we can fix it.', ephemeral: true });
                return;
            }
            const trimmedDate = applicationDateStr.split(',')[0].trim();
            const applicationDate = moment(trimmedDate, 'M/D/YYYY', true);
            if (!applicationDate.isValid()) {
                await interaction.editReply({ content: `We found your application, but the date stored ('${applicationDateStr}'). Please note that we begin pulling new form data every Sunday, and platform check data is updated on Mondays. If you believe there's an issue with your submission, please contact support to verify the sheet data.`, ephemeral: true });
                return;
            }
            if (!userIGDataRow) {
                const nextMonday = `<t:${getNextMonday().unix()}:F>`;
                await interaction.editReply({ content: `Thanks for applying on **${applicationDate.format('MMMM Do, YYYY')}**! Your stats haven’t shown up in our dashboard yet. We refresh the data every Monday—check back around ${nextMonday}.`, ephemeral: true });
                return;
            }

            const requirements = { posts: 2, likes: 15 };

            const followersStr = userIGDataRow[6] || 'N/A';

            const extractWeek = (postIdx, likesIdx, qualityIdx) => {
                const posts = parseInt(userIGDataRow[postIdx], 10) || 0;
                const likes = parseInt(userIGDataRow[likesIdx], 10) || 0;
                return {
                    posts,
                    likes,
                    quality: userIGDataRow[qualityIdx] || 'N/A',
                    metPosts: posts >= requirements.posts,
                    metLikes: likes >= requirements.likes
                };
            };

            const week1 = extractWeek(7, 9, 10);
            const week2 = extractWeek(12, 14, 15);
            const week3 = extractWeek(17, 19, 20);

            const formatWeek = (label, data) => {
                let msg = `**${label}:**\nPosts: \`${data.posts}\` | Avg Likes: \`${data.likes}\` | Avg Quality: \`${data.quality}\`\n`;
                if (!data.metPosts || !data.metLikes) {
                    const missing = [];
                    if (!data.metPosts) missing.push(`Need ≥ ${requirements.posts} posts`);
                    if (!data.metLikes) missing.push(`Need ≥ ${requirements.likes} avg likes`);
                    msg += '**Missing:** ' + missing.join('; ') + '\n';
                } else {
                    msg += '**Requirements Met** ✅\n';
                }
                return msg;
            };

            const embed = new EmbedBuilder()
                .setTitle('📊 Your Instagram 3‑Week Stats')
                .setColor('#E1306C')
                .setDescription(
                    `**Followers:** ${followersStr}\n\n` +
                    formatWeek('3 weeks ago', week1) + '\n' +
                    formatWeek('2 weeks ago', week2) + '\n' +
                    formatWeek('Last week', week3)
                )
                .setTimestamp()
                .setFooter({ text: 'Instagram CC Requirements Check' });

            await interaction.editReply({ embeds: [embed], ephemeral: false });
        } catch {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: 'An unexpected error occurred while processing your request.', ephemeral: true });
            } else {
                await interaction.editReply({ content: 'An unexpected error occurred while processing your request.', ephemeral: true });
            }
        }
    }
};
