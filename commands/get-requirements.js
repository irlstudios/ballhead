const {SlashCommandBuilder} = require('@discordjs/builders');
const {EmbedBuilder} = require('discord.js');
const {google} = require('googleapis');
const credentials = require('../resources/secret.json');
const moment = require('moment');

function authorize() {
    const {client_email, private_key} = credentials;
    const auth = new google.auth.JWT(
        client_email,
        null,
        private_key,
        ['https://www.googleapis.com/auth/spreadsheets']
    );
    return auth;
}

const sheets = google.sheets({version: 'v4', auth: authorize()});
const sheetId = '15P8BKPbO2DQX6yRXmc9gzuL3iLxfu4ef83Jb8Bi8AJk';
const rangeTikTok = 'TikTok!A:I';
const rangeTTData = 'TT Data';

async function getUserData(discordId) {
    try {
        console.log(`Fetching data from Google Sheets for user ID: ${discordId}`);
        const resTikTok = await sheets.spreadsheets.values.get({
            spreadsheetId: sheetId,
            range: rangeTikTok,
        });

        const resTTData = await sheets.spreadsheets.values.get({
            spreadsheetId: sheetId,
            range: rangeTTData,
        });

        const rowsTikTok = resTikTok.data.values;
        const rowsTTData = resTTData.data.values;
        console.log('Data fetched from Google Sheets:', rowsTikTok.length, 'rows found in TikTok,', rowsTTData.length, 'rows found in TT Data.');

        let userTikTokRow = null;
        for (const row of rowsTikTok) {
            if (row[2] === discordId) {
                userTikTokRow = row;
                break;
            }
        }

        if (!userTikTokRow) {
            console.log('No matching row found for user ID in TikTok sheet:', discordId);
            return null;
        }

        let userTTDataRow = null;
        for (const row of rowsTTData) {
            if (row[10] === discordId) {
                userTTDataRow = row;
                break;
            }
        }

        return {userTikTokRow, userTTDataRow};
    } catch (error) {
        console.error('Error fetching user data from Google Sheets:', error);
        return null;
    }
}

function getNextMonday() {
    const now = moment();
    const nextMonday = now.clone().day(8);
    return nextMonday;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('check-tiktok-account')
        .setDescription('Fetches the user\'s 3-week requirement data'),
    async execute(interaction) {
        console.log(`Command /check-tiktok-account invoked by ${interaction.user.tag}`);

        try {
            await interaction.deferReply({ephemeral: true});
            console.log('Reply deferred.');

            const userId = interaction.user.id;
            console.log(`Fetching data for user ID: ${userId}`);
            const userData = await getUserData(userId);

            if (userData && userData.userTikTokRow) {
                const {userTikTokRow, userTTDataRow} = userData;
                const applicationDate = moment(userTikTokRow[7], 'MM/DD/YYYY');
                const lastDataPullDate = moment().day(-1).subtract(1, 'week');

                let appliedWhen;
                if (applicationDate.isBefore(lastDataPullDate)) {
                    appliedWhen = 'before';
                } else {
                    appliedWhen = 'after';
                }

                const nextCheckDate = getNextMonday();
                const discordFormattedTimestamp = `<t:${nextCheckDate.unix()}:F>`;

                if (!userTTDataRow) {
                    const response = `Sorry, it looks like you may have applied **${appliedWhen}** the data was pulled. Please check back on ${discordFormattedTimestamp}.`;
                    await interaction.editReply({content: response, ephemeral: true});
                    console.log('No data found for user; provided info about application timing.');
                    return;
                }

                const requirements = {
                    posts: 2,
                    likes: 20
                };

                const checkRequirements = (posts, likes) => {
                    const metPosts = posts >= requirements.posts;
                    const metLikes = likes >= requirements.likes;
                    return {metPosts, metLikes};
                };

                const week1 = checkRequirements(userTTDataRow[16], userTTDataRow[18]);
                const week2 = checkRequirements(userTTDataRow[20], userTTDataRow[22]);
                const week3 = checkRequirements(userTTDataRow[24], userTTDataRow[26]);

                const generateRequirementMessage = (week, data, metPosts, metLikes) => {
                    let message = `**${week}:**\n**Number of posts:** ${data.posts}\n**Average Likes:** ${data.likes}\n**Number of Followers:** ${userTTDataRow[15]}\n`;
                    if (!metPosts || !metLikes) {
                        message += '**Missing Requirements:**\n';
                        if (!metPosts) message += `- At least ${requirements.posts} posts\n`;
                        if (!metLikes) message += `- At least ${requirements.likes} average likes\n`;
                    } else {
                        message += '**Requirements Met**\n';
                    }
                    return message;
                };

                const embed = new EmbedBuilder()
                    .setTitle('Your 3-week TikTok Requirement Data')
                    .setColor('#0099ff')
                    .setDescription(
                        generateRequirementMessage('Week 1', {
                            posts: userTTDataRow[16],
                            likes: userTTDataRow[18]
                        }, week1.metPosts, week1.metLikes) +
                        '\n' +
                        generateRequirementMessage('Week 2', {
                            posts: userTTDataRow[20],
                            likes: userTTDataRow[22]
                        }, week2.metPosts, week2.metLikes) +
                        '\n' +
                        generateRequirementMessage('Week 3', {
                            posts: userTTDataRow[24],
                            likes: userTTDataRow[26]
                        }, week3.metPosts, week3.metLikes)
                    )
                    .setFooter({text: 'TikTok Requirements', iconURL: 'https://example.com/icon.png'})
                    .setTimestamp();

                if (!interaction.deferred && !interaction.replied) {
                    await interaction.reply({embeds: [embed], ephemeral: true});
                } else {
                    await interaction.editReply({embeds: [embed], ephemeral: true});
                }

                console.log('Reply edited with user data.');
            } else {
                await interaction.editReply({content: 'You have not applied for the CC program.', ephemeral: true});
                console.log('User has not applied for CC program.');
            }
        } catch (error) {
            console.error('Error in /check-tiktok-account command:', error);
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({
                    content: 'There was an error while executing this command!',
                    ephemeral: true
                });
            } else {
                await interaction.reply({content: 'There was an error while executing this command!', ephemeral: true});
            }
        }
    },
};
