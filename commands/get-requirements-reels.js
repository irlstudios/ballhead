const {SlashCommandBuilder} = require('@discordjs/builders');
const {EmbedBuilder} = require('discord.js');
const {google} = require('googleapis');
const axios = require('axios');
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
const rangeReels = 'Reels!A:I';
const rangeIGData = 'IG Data';

async function getUserData(discordId) {
    try {
        console.log(`Fetching data from Google Sheets for user ID: ${discordId}`);
        const resReels = await sheets.spreadsheets.values.get({
            spreadsheetId: sheetId,
            range: rangeReels,
        });

        const resIGData = await sheets.spreadsheets.values.get({
            spreadsheetId: sheetId,
            range: rangeIGData,
        });

        const rowsReels = resReels.data.values;
        const rowsIGData = resIGData.data.values;
        console.log(`Data fetched from Google Sheets: ${rowsReels.length} rows found in Reels, ${rowsIGData.length} rows found in IG Data.`);

        let userReelsRow = null;
        for (const row of rowsReels) {
            if (row[2] === discordId) {
                userReelsRow = row;
                break;
            }
        }

        if (!userReelsRow) {
            console.log(`No matching row found for user ID in Reels sheet:`, discordId);
            return {applied: false};
        }

        let userIGDataRow = null;
        for (const row of rowsIGData) {
            if (row[11] === discordId) {
                userIGDataRow = row;
                break;
            }
        }

        if (!userIGDataRow) {
            console.log(`No matching row found for user ID in IG Data sheet:`, discordId);
            return {applied: true, appliedDate: userReelsRow[7]};
        }

        return {
            applied: true,
            appliedDate: userReelsRow[7],
            week1: userIGDataRow[29],
            week2: userIGDataRow[30],
            week3: userIGDataRow[31],
            posts_week1: userIGDataRow[16],
            likes_week1: userIGDataRow[18],
            posts_week2: userIGDataRow[20],
            likes_week2: userIGDataRow[22],
            posts_week3: userIGDataRow[24],
            likes_week3: userIGDataRow[26],
            followers: userIGDataRow[15]
        };
    } catch (error) {
        console.error(`Error fetching user data from Google Sheets for Instagram:`, error);
        return null;
    }
}

function getNextCheckDate() {
    const now = new Date();
    const nextMonday = new Date(now);
    nextMonday.setDate(now.getDate() + ((8 - now.getDay()) % 7));
    nextMonday.setHours(0, 0, 0, 0);
    return `<t:${Math.floor(nextMonday.getTime() / 1000)}:F>`;
}

function getApplicationDateStatus(appliedDate) {
    const now = new Date();
    const lastSunday = new Date(now);
    lastSunday.setDate(now.getDate() - now.getDay());
    lastSunday.setHours(0, 0, 0, 0);

    const appliedDateObj = new Date(appliedDate);
    return appliedDateObj < lastSunday ? 'before' : 'after';
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('check-reels-account')
        .setDescription('Fetches the user\'s 3-week requirement data for Instagram'),
    async execute(interaction) {
        console.log(`Command /check-reels-account invoked by ${interaction.user.tag}`);

        try {
            await interaction.deferReply({ephemeral: true});
            console.log('Reply deferred.');

            const userId = interaction.user.id;
            console.log(`Fetching data for user ID: ${userId}`);
            const data = await getUserData(userId);

            if (data && data.applied) {
                if (!data.week1 && !data.week2 && !data.week3) {
                    const applicationDate = getApplicationDateStatus(data.appliedDate);
                    const nextCheckDate = getNextCheckDate();

                    await interaction.editReply({
                        content: `Sorry, it looks like you may have applied **${applicationDate}** the data was pulled, please check back on **${nextCheckDate}**.`,
                        ephemeral: true
                    });
                    console.log('No data found for user, but they applied.');
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

                const week1 = checkRequirements(data.posts_week1, data.likes_week1);
                const week2 = checkRequirements(data.posts_week2, data.likes_week2);
                const week3 = checkRequirements(data.posts_week3, data.likes_week3);

                const generateRequirementMessage = (week, data, metPosts, metLikes) => {
                    let message = `**${week}:**\n**Number of posts:** ${data.posts}\n**Average Likes:** ${data.likes}\n**Number of Followers:** ${data.followers}\n`;
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
                    .setTitle(`Your 3-week Instagram Requirement Data`)
                    .setColor('#0099ff')
                    .setDescription(
                        generateRequirementMessage('Week 1', {
                            posts: data.posts_week1,
                            likes: data.likes_week1,
                            followers: data.followers
                        }, week1.metPosts, week1.metLikes) +
                        '\n' +
                        generateRequirementMessage('Week 2', {
                            posts: data.posts_week2,
                            likes: data.likes_week2,
                            followers: data.followers
                        }, week2.metPosts, week2.metLikes) +
                        '\n' +
                        generateRequirementMessage('Week 3', {
                            posts: data.posts_week3,
                            likes: data.likes_week3,
                            followers: data.followers
                        }, week3.metPosts, week3.metLikes)
                    )
                    .setFooter({text: `Instagram Requirements`, iconURL: 'https://example.com/icon.png'})
                    .setTimestamp();

                await interaction.editReply({embeds: [embed], ephemeral: true});
                console.log('Reply edited with user data.');
            } else if (data && !data.applied) {
                await interaction.editReply({
                    content: 'No data found for your account, and it appears you haven’t applied for the CC role yet.',
                    ephemeral: true
                });
                console.log('User has not applied for the CC role.');
            } else {
                await interaction.editReply({
                    content: 'No data found for your account.',
                    ephemeral: true
                });
                console.log('No data found for user.');
            }
        } catch (error) {
            console.error('Error in /check-reels-account command:', error);
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
