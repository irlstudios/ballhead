const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { google } = require('googleapis');
const credentials = require('../resources/secret.json');

const SEASON_YEAR = 2025;

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


async function getSheetData() {
    const sheets = google.sheets({ version: 'v4', auth: authorize() });
    const postsResponse = await sheets.spreadsheets.values.get({
        spreadsheetId: '1Ze84DPzXsdaGAsg_t5MJMbmvGJlF1Q03R-uJ-OdpfU0',
        range: 'Season 14 Posts',
    });
    const postsRows = postsResponse.data.values;
    if (!postsRows || postsRows.length === 0) {
        throw new Error('No data found in Season 13 Posts sheet.');
    }
``

    const weeksResponse = await sheets.spreadsheets.values.get({
        spreadsheetId: '1Ze84DPzXsdaGAsg_t5MJMbmvGJlF1Q03R-uJ-OdpfU0',
        range: 'Season Weeks <> Date',
    });
    const weeksRows = weeksResponse.data.values;
    if (!weeksRows || weeksRows.length === 0) {
        throw new Error('No data found in Season Weeks <> Date sheet.');
    }

    const weekDateMap = {};
    weeksRows.forEach(row => {
        const [weekStr, dateStr] = row;
        const weekMatch = weekStr.match(/Week\s+(\d+)/);
        if (weekMatch) {
            const weekNumber = parseInt(weekMatch[1], 10);
            weekDateMap[weekNumber] = dateStr.trim();
        }
    });

    return {
        postsRows,
        weekDateMap
    };
}

function processData(postsRows, weekDateMap, userId, platformFilter = null) {
    const headers = postsRows[0];
    const data = postsRows.slice(1);

    const userData = {
        username: 'Unknown',
        runningAverage: 'N/A',
        weeklyAverages: {},
        posts: [],
    };

    let totalQuality = 0;
    let count = 0;
    const weeklyScores = {};

    data.forEach((row) => {
        const [
            rowUserId, platform, type, ownerUsername, ownerId, likesCount, url,
            timestamp, followersCount, caption, videoDuration, videoViewCount,
            averageQuality, week, cartersScores, shawnsScores, postCount,
            coreId, validPost, validPostBool, hasHashtag, activeLastWeeks,
            activeThatWeek, includedInCalendar
        ] = row;

        const trimmedUserId = rowUserId ? rowUserId.trim() : '';
        const trimmedPlatform = platform ? platform.trim().toLowerCase() : '';

        if (platformFilter) {
            if (trimmedPlatform !== platformFilter.toLowerCase()) {
                return;
            }
        }

        if (trimmedUserId !== userId) {
            return;
        }

        if (ownerUsername) {
            userData.username = ownerUsername.trim();
        }

        const qualityScore = averageQuality ? parseFloat(averageQuality.trim()) : NaN;
        const weekNumber = week ? parseInt(week.trim(), 10) : NaN;

        let formattedDate = 'N/A';
        let unixTimestamp = 0;
        if (!isNaN(weekNumber) && weekDateMap[weekNumber]) {
            const [month, day] = weekDateMap[weekNumber].split('/').map(Number);
            const dateObj = new Date(Date.UTC(SEASON_YEAR, month - 1, day, 12, 0, 0));
            unixTimestamp = Math.floor(dateObj.getTime() / 1000);
            formattedDate = `<t:${unixTimestamp}:D>`;
        }

        const post = {
            score: !isNaN(qualityScore) ? qualityScore.toFixed(2) : 'N/A',
            likes: likesCount ? likesCount.trim() : 'N/A',
            details: caption ? caption.trim() : 'No caption provided.',
            week: !isNaN(weekNumber) ? weekNumber : 'N/A',
            timestamp: timestamp ? timestamp.trim() : 'N/A',
            url: url ? url.trim() : 'N/A',
            weekDate: unixTimestamp,
        };

        userData.posts.push(post);

        if (!isNaN(qualityScore)) {
            totalQuality += qualityScore;
            count += 1;
        }

        if (!isNaN(qualityScore) && !isNaN(weekNumber)) {
            if (!weeklyScores[weekNumber]) {
                weeklyScores[weekNumber] = { total: 0, count: 0 };
            }
            weeklyScores[weekNumber].total += qualityScore;
            weeklyScores[weekNumber].count += 1;
        }
    });

    if (count > 0) {
        userData.runningAverage = (totalQuality / count).toFixed(2);
    }

    for (const week in weeklyScores) {
        const { total, count } = weeklyScores[week];
        userData.weeklyAverages[week] = count > 0 ? (total / count).toFixed(2) : 'N/A';
    }

    console.info(`Processed ${userData.posts.length} posts for user ID ${userId} on platform ${platformFilter || 'All Platforms'}.`);

    return userData;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('quality-score')
        .setDescription('Find your quality score for this CC season')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to view quality scores of')
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('platform')
                .setDescription('The platform to filter your quality scores by')
                .setRequired(false)
                .addChoices(
                    { name: 'YouTube', value: 'YouTube' },
                    { name: 'Instagram', value: 'Reels' },
                    { name: 'TikTok', value: 'TikTok' },
                )
        ),

    async execute(interaction) {
        try {
            const targetUser = interaction.options.getUser('user') || interaction.user;
            const userId = targetUser.id;
            const userName = targetUser.username;
            const userAvatar = targetUser.displayAvatarURL({ dynamic: true });

            const platformOption = interaction.options.getString('platform') || null;

            const { postsRows, weekDateMap } = await getSheetData();
            const userData = processData(postsRows, weekDateMap, userId, platformOption);

            if (userData.posts.length === 0) {
                const platformText = platformOption ? `on ${platformOption}` : 'across all platforms';
                await interaction.reply({ content: `No quality scores found for this user ${platformText}.`, ephemeral: true });
                return;
            }

            const currentPage = 1;
            const totalPages = userData.posts.length + 1;
            const overviewEmbed = new EmbedBuilder()
                .setTitle(`${userData.username}'s Quality Scores - Overview`)
                .setThumbnail(userAvatar)
                .setColor(platformOption ? '#32CD32' : '#0099ff')
                .addFields(
                    { name: '📈 Running Average (Season)', value: userData.runningAverage.toString(), inline: true },
                    { name: '🟢 Average Quality', value: userData.runningAverage.toString(), inline: true }
                );

            const formattedWeeklyFields = Object.entries(userData.weeklyAverages).map(([week, score]) => {
                const weekNumber = parseInt(week, 10);
                let formattedDate = 'N/A';
                if (weekDateMap[weekNumber]) {
                    const [month, day] = weekDateMap[weekNumber].split('/').map(Number);
                    const dateObj = new Date(Date.UTC(SEASON_YEAR, month - 1, day, 12, 0, 0));
                    const unixTimestamp = Math.floor(dateObj.getTime() / 1000);
                    formattedDate = `<t:${unixTimestamp}:D>`;
                }
                return {
                    name: `📅 Week ${weekNumber}`,
                    value: `Date: ${formattedDate}\nAverage Score: ${score}`,
                    inline: true,
                };
            });

            if (formattedWeeklyFields.length > 0) {
                overviewEmbed.addFields(formattedWeeklyFields);
            } else {
                overviewEmbed.addFields({ name: '📅 Weekly Averages', value: 'No weekly data available.', inline: false });
            }

            const prevButton = new ButtonBuilder()
                .setCustomId('prev2')
                .setLabel('Previous')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(true);

            const nextButton = new ButtonBuilder()
                .setCustomId('next2')
                .setLabel('Next')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(userData.posts.length === 0);

            const actionRow = new ActionRowBuilder().addComponents(prevButton, nextButton);

            const reply = await interaction.reply({
                embeds: [overviewEmbed],
                components: [actionRow],
                fetchReply: true,
            });

            if (!reply) {
                throw new Error('Failed to fetch reply message.');
            }

            if (!interaction.client.commandData) {
                interaction.client.commandData = new Map();
            }

            interaction.client.commandData.set(reply.id, {
                posts: userData.posts,
                totalPages: totalPages,
                currentPage: currentPage,
                username: userData.username,
                userAvatar: userAvatar,
                runningAverage: userData.runningAverage,
                weeklyAverages: userData.weeklyAverages,
                weekDateMap: weekDateMap,
            });

            setTimeout(() => {
                interaction.client.commandData.delete(reply.id);
            }, 10 * 60 * 1000);

        } catch (error) {
            console.error(`Error fetching quality scores: ${error.message}`);

            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: 'An error occurred while fetching quality scores.', ephemeral: true });
            } else {
                await interaction.editReply({ content: 'An error occurred while fetching quality scores.' });
            }
        }
    },
};