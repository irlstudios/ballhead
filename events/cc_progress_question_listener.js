const { EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const credentials = require('../resources/secret.json');
const moment = require('moment');

function authorize() {
    const { client_email, private_key } = credentials;
    return new google.auth.JWT(
        client_email,
        null,
        private_key,
        ['https://www.googleapis.com/auth/spreadsheets']
    );
}

const sheets = google.sheets({ version: 'v4', auth: authorize() });
const sheetId = '15P8BKPbO2DQX6yRXmc9gzuL3iLxfu4ef83Jb8Bi8AJk';

// Platform configurations
const PLATFORMS = {
    tiktok: {
        name: 'TikTok',
        appRange: 'CC Applications!A:G',
        dataRange: 'TikTok Data!A:O',
        activeCreatorsRange: 'Active Creators!A:K',  // Platform | Status | P Username | DD ID | P ID | P Link | Date Earned | Weighed QS | Total Points | Last Updated | Latest Post Date
        paidCreatorsRange: 'Paid Creators!A:F',      // Status | Platform | P Username | DD ID | P Link | P ID
        platformKey: 'Tiktok',
        requirements: { followers: 50, weeklyPoints: 8, weeksRequired: 3 },
        color: '#00f2ea',
        emoji: '🎵',
        weekColumnIndex: 14  // Col O: Season Week Posted
    },
    youtube: {
        name: 'YouTube',
        appRange: 'CC Applications!A:G',
        dataRange: 'YouTube Data!A:P',  // YouTube has extra "Is Short?" column
        activeCreatorsRange: 'Active Creators!A:K',  // Platform | Status | P Username | DD ID | P ID | P Link | Date Earned | Weighed QS | Total Points | Last Updated | Latest Post Date
        paidCreatorsRange: 'Paid Creators!A:F',      // Status | Platform | P Username | DD ID | P Link | P ID
        platformKey: 'YouTube',
        requirements: { followers: 50, weeklyPoints: 8, weeksRequired: 3 },
        color: '#FF0000',
        emoji: '🎬',
        weekColumnIndex: 15  // Col P: Season Week Posted (YouTube has extra "Is Short?" column at O)
    },
    reels: {
        name: 'Instagram',
        appRange: 'CC Applications!A:G',
        dataRange: 'Reels Data!A:O',
        activeCreatorsRange: 'Active Creators!A:K',  // Platform | Status | P Username | DD ID | P ID | P Link | Date Earned | Weighed QS | Total Points | Last Updated | Latest Post Date
        paidCreatorsRange: 'Paid Creators!A:F',      // Status | Platform | P Username | DD ID | P Link | P ID
        platformKey: 'Reels',
        requirements: { followers: 50, weeklyPoints: 8, weeksRequired: 3 },
        color: '#E1306C',
        emoji: '📸',
        weekColumnIndex: 14  // Col O: Season Week Posted
    }
};

// Phrases that trigger the CC progress check
const ccQuestionPhrases = [
    'why didnt i get cc',
    'why didnt i get content creator',
    'why no cc',
    'why havent i gotten cc',
    'why havent i gotten content creator',
    'when do i get cc',
    'when will i get cc',
    'when can i get cc',
    'how do i get cc',
    'how do i get content creator',
    'why am i not cc',
    'why am i not content creator',
    'why cant i get cc',
    'why cant i get content creator',
    'what are cc requirements',
    'what are content creator requirements',
    'cc requirements',
    'content creator requirements',
    'how to get content creator',
    'why not cc',
    'am i eligible for cc',
    'am i eligible for content creator',
    'do i qualify for cc',
    'do i qualify for content creator',
    'check my cc progress',
    'check my content creator progress',
    'cc progress',
    'my cc progress',
    'cc application status',
    'content creator application status',
    'status of my cc application',
    'status of my content creator application',
    'how come i dont have cc',
    'how come i dont have content creator',
    'how long until i get cc',
    'do i meet cc requirements',
    'do i meet content creator requirements'
];

const ccQuestionPatterns = [
    /why[\s'\u2019.,!?]*didn['\u2019]?t[\s'\u2019.,!?]*i[\s'\u2019.,!?]*(?:get|receive)[\s'\u2019.,!?]*(?:cc|content[\s'\u2019.,!?]*creator)/i,
    /how[\s'\u2019.,!?]*do[\s'\u2019.,!?]*i[\s'\u2019.,!?]*(?:get|unlock)[\s'\u2019.,!?]*(?:cc|content[\s'\u2019.,!?]*creator)/i,
    /when[\s'\u2019.,!?]*(?:can|will|do)[\s'\u2019.,!?]*i[\s'\u2019.,!?]*get[\s'\u2019.,!?]*(?:cc|content[\s'\u2019.,!?]*creator)/i,
    /do[\s'\u2019.,!?]*i[\s'\u2019.,!?]*(?:qualify|meet)[\s'\u2019.,!?]*for[\s'\u2019.,!?]*(?:cc|content[\s'\u2019.,!?]*creator)/i,
    /content[\s'\u2019.,!?]*creator[\s'\u2019.,!?]*(?:requirements|progress|status)/i,
    /cc[\s'\u2019.,!?]*progress/i
];

async function getPlatformData(platform, discordId) {
    try {
        const config = PLATFORMS[platform];

        const [appRes, dataRes, activeRes, paidRes] = await Promise.all([
            sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: config.appRange }),
            sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: config.dataRange }),
            sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: config.activeCreatorsRange }),
            sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: config.paidCreatorsRange })
        ]);

        const appRows = appRes.data.values || [];
        const dataRows = dataRes.data.values || [];
        const activeRows = activeRes.data.values || [];
        const paidRows = paidRes.data.values || [];

        let appRow = null;
        for (const row of appRows) {
            if (row && row.length > 3) {
                const rowPlatform = row[0]?.trim();
                const rowDiscordId = row[2]?.trim();
                if (rowPlatform?.toLowerCase() === config.platformKey.toLowerCase() &&
                    rowDiscordId === discordId) {
                    appRow = row;
                    break;
                }
            }
        }

        if (!appRow) return null;

        const username = appRow[1]?.trim();
        if (!username) return null;

        const platformId = appRow[4]?.trim();
        const userPosts = dataRows.filter(row => {
            if (!row || row.length < 15) return false;
            const postUsername = row[0]?.trim();
            const postPlatformId = row[1]?.trim();
            return (postUsername?.toLowerCase() === username.toLowerCase()) ||
                   (platformId && postPlatformId === platformId);
        });

        // Check if user is in Active Creators or Paid Creators (for this specific platform)
        // Sheet format: Platform | Status | P Username | DD ID | P ID | P Link | Date Earned | Weighed QS | Total Points | Last Updated | Latest Post Date
        let activeCreatorRow = null;
        let paidCreatorRow = null;

        for (const row of activeRows) {
            if (row && row.length > 4) {
                const rowPlatform = row[0]?.trim(); // Col A: Platform
                const rowDiscordId = row[3]?.trim(); // Col D: DD ID
                if (rowPlatform?.toLowerCase() === config.platformKey.toLowerCase() &&
                    rowDiscordId === discordId) {
                    activeCreatorRow = row;
                    break;
                }
            }
        }

        // Paid Creators sheet format: Status | Platform | P Username | DD ID | P Link | P ID
        for (const row of paidRows) {
            if (row && row.length > 3) {
                const rowPlatform = row[1]?.trim(); // Col B: Platform
                const rowDiscordId = row[3]?.trim(); // Col D: DD ID
                if (rowPlatform?.toLowerCase() === config.platformKey.toLowerCase() &&
                    rowDiscordId === discordId) {
                    paidCreatorRow = row;
                    break;
                }
            }
        }

        return {
            appRow,
            userPosts,
            activeCreatorRow,
            paidCreatorRow,
            platformId,
            config
        };
    } catch (error) {
        console.error(`Error fetching ${platform} data:`, error);
        return null;
    }
}

/**
 * Analyzes user posts and groups them by week to calculate points
 * Uses the actual week identifiers from the spreadsheet (Season Week Posted column)
 * @param {Array} userPosts - Array of post rows from platform data sheet
 * @param {Object} config - Platform configuration with weekColumnIndex
 * @returns {Object} Weekly stats including followers, points per week, and consecutive weeks met
 */
function analyzeWeeklyProgress(userPosts, config) {
    if (!userPosts || userPosts.length === 0) {
        return {
            followers: 'N/A',
            weeklyStats: {},
            consecutiveWeeksMet: 0,
            totalValidPosts: 0,
            allWeeks: []
        };
    }

    const followerCount = userPosts[0]?.[5] || 'N/A';

    const weeklyStats = {};
    let totalValidPosts = 0;

    const weekColIndex = config.weekColumnIndex || 14;

    for (const post of userPosts) {
        if (!post || post.length <= weekColIndex) continue;

        const seasonWeek = post[weekColIndex]?.toString().trim(); // Season Week Posted (col varies by platform)
        const pointsEarned = parseFloat(post[12]) || 0;
        const isValid = post[13]?.trim()?.toLowerCase() === 'true' || post[13]?.trim() === 'TRUE';
        const qualityScore = parseFloat(post[11]) || 0;

        // Skip posts without a valid week number
        if (!seasonWeek || seasonWeek === 'TRUE' || seasonWeek === 'FALSE') continue;

        if (!weeklyStats[seasonWeek]) {
            weeklyStats[seasonWeek] = {
                totalPoints: 0,
                validPosts: 0,
                totalPosts: 0,
                avgQuality: 0,
                qualitySum: 0
            };
        }

        weeklyStats[seasonWeek].totalPosts++;

        if (isValid) {
            weeklyStats[seasonWeek].totalPoints += pointsEarned;
            weeklyStats[seasonWeek].validPosts++;
            weeklyStats[seasonWeek].qualitySum += qualityScore;
            totalValidPosts++;
        }
    }

    for (const week in weeklyStats) {
        const stats = weeklyStats[week];
        if (stats.validPosts > 0) {
            stats.avgQuality = (stats.qualitySum / stats.validPosts).toFixed(2);
        }
    }

    // Calculate consecutive weeks meeting requirements (8 points)
    const allWeeks = Object.keys(weeklyStats).sort();
    let maxConsecutive = 0;
    let currentStreak = 0;

    for (const week of allWeeks) {
        if (weeklyStats[week].totalPoints >= 8) {
            currentStreak++;
            maxConsecutive = Math.max(maxConsecutive, currentStreak);
        } else {
            currentStreak = 0;
        }
    }

    return {
        followers: followerCount,
        weeklyStats,
        consecutiveWeeksMet: maxConsecutive,
        totalValidPosts,
        allWeeks // All weeks that have data, sorted chronologically
    };
}

function formatPlatformEmbed(platform, platformData) {
    const { appRow, userPosts, activeCreatorRow, paidCreatorRow, config } = platformData;

    // Check if user is already a CC on this platform (Active or Paid)
    const isActiveCreator = activeCreatorRow !== null;
    const isPaidCreator = paidCreatorRow !== null;

    if (isActiveCreator || isPaidCreator) {
        const ccType = isPaidCreator ? 'Paid' : 'Active';
        return {
            name: `${config.emoji} ${config.name}`,
            value: '😄 You\'re already a ' + ccType + ' Content Creator for ' + config.name + ', silly!\n\n' +
                   'Keep posting great content and check out `/quality-score` to see your tracked posts.',
            inline: false
        };
    }

    const appDateStr = appRow[3];
    if (!appDateStr) {
        return {
            name: `${config.emoji} ${config.name}`,
            value: '⚠️ Application found but date is missing. Contact support.',
            inline: false
        };
    }

    const trimmedDate = appDateStr.split(',')[0].trim();
    // Try multiple date formats
    const dateFormats = ['M/D/YY', 'MM/DD/YY', 'M/D/YYYY', 'MM/DD/YYYY'];
    let appDate = moment(trimmedDate, dateFormats, true);

    if (!appDate.isValid()) {
        return {
            name: `${config.emoji} ${config.name}`,
            value: `⚠️ Application date format issue ('${trimmedDate}'). Data updates on Mondays.`,
            inline: false
        };
    }

    if (!userPosts || userPosts.length === 0) {
        const nextMonday = moment().day(8);
        return {
            name: `${config.emoji} ${config.name}`,
            value: `✅ Applied on ${appDate.format('MMM D, YYYY')}\n⏳ No posts tracked yet. Check back <t:${nextMonday.unix()}:R>`,
            inline: false
        };
    }

    const progress = analyzeWeeklyProgress(userPosts, config);
    const req = config.requirements;
    const followerLabel = platform === 'youtube' ? 'Subscribers' : 'Followers';

    let statusLines = [];

    // If no weeks have data yet
    if (Object.keys(progress.weeklyStats).length === 0) {
        return {
            name: `${config.emoji} ${config.name}`,
            value: `✅ Applied on ${appDate.format('MMM D, YYYY')}\n⏳ No valid posts with week assignments yet.`,
            inline: false
        };
    }

    // Get the 3 most recent weeks from actual data (not calculated)
    const allWeeksWithData = progress.allWeeks;
    const recentWeeks = allWeeksWithData.slice(-3);

    // Display the most recent weeks that have actual data
    let weekLabels;
    if (recentWeeks.length === 1) {
        weekLabels = ['Current/Last week'];
    } else if (recentWeeks.length === 2) {
        weekLabels = ['2 weeks ago', 'Last week'];
    } else {
        weekLabels = ['3 weeks ago', '2 weeks ago', 'Last week'];
    }

    for (let i = 0; i < recentWeeks.length; i++) {
        const weekKey = recentWeeks[i];
        const stats = progress.weeklyStats[weekKey];
        const metRequirement = stats.totalPoints >= req.weeklyPoints;
        const status = metRequirement ? '✅' : '❌';

        statusLines.push(
            `**${weekLabels[i]} (${weekKey}):** ${status}\n` +
            `Points: \`${stats.totalPoints.toFixed(1)}\` | Valid Posts: \`${stats.validPosts}\` | Avg Quality: \`${stats.avgQuality}\``
        );
    }

    const followerCount = parseInt(progress.followers);
    const meetsFollowerReq = !isNaN(followerCount) && followerCount >= req.followers;
    const followerStatus = meetsFollowerReq ? '✅' : '❌';

    const meetsConsecutiveReq = progress.consecutiveWeeksMet >= req.weeksRequired;
    const consecutiveStatus = meetsConsecutiveReq ? '✅' : '❌';

    let statusHeader = '';
    if (meetsFollowerReq && meetsConsecutiveReq) {
        statusHeader = '🎉 **Eligible for Content Creator Role!**\n\n';
    }

    return {
        name: `${config.emoji} ${config.name}`,
        value: statusHeader +
               `**${followerLabel}:** ${progress.followers} ${followerStatus} (need ${req.followers})\n` +
               `**Consecutive Weeks (${req.weeklyPoints}+ pts):** ${progress.consecutiveWeeksMet}/${req.weeksRequired} ${consecutiveStatus}\n` +
               `**Requirements:** ${req.weeklyPoints} points/week for ${req.weeksRequired} consecutive weeks\n\n` +
               statusLines.join('\n\n'),
        inline: false
    };
}

module.exports = {
    name: 'messageCreate',
    once: false,
    async execute(message) {
        // Ignore bot messages and DMs
        if (message.author.bot) return;
        if (message.channel.isDMBased()) return;

        // Check if message contains any CC question phrase
        const rawContent = message.content;
        const normalizedContent = rawContent.toLowerCase();
        const sanitizedContent = normalizedContent
            .replace(/['\u2019]/g, '')
            .replace(/[^a-z0-9\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const matchesPhrase = ccQuestionPhrases.some(phrase =>
            sanitizedContent.includes(phrase)
        );
        const matchesRegex = ccQuestionPatterns.some(pattern =>
            pattern.test(rawContent)
        );

        if (!matchesPhrase && !matchesRegex) return;

        try {
            const userId = message.author.id;
            const platformResults = {};
            const existingCCPlatforms = [];

            // Check all platforms
            for (const [key, config] of Object.entries(PLATFORMS)) {
                const data = await getPlatformData(key, userId);
                if (data && data.appRow) {
                    platformResults[key] = data;
                } else if (data && (data.activeCreatorRow || data.paidCreatorRow)) {
                    // User is a CC on this platform but has no application
                    existingCCPlatforms.push(config.name);
                }
            }

            // If no applications found
            if (Object.keys(platformResults).length === 0) {
                if (existingCCPlatforms.length > 0) {
                    await message.reply({
                        content: 'Hey <@' + userId + '>! Looks like you\'re already a CC, silly! 😄\n\n' +
                                 'You\'re a Content Creator for: **' + existingCCPlatforms.join(', ') + '**\n\n' +
                                 'You also don\'t have any open applications to other platforms.'
                    });
                } else {
                    await message.reply({
                        content: 'Hey <@' + userId + '>! You haven\'t applied for any CC programs yet.\n\nUse `/tiktok-cc-apply`, `/youtube-cc-apply`, or `/instagram-cc-apply` to get started!'
                    });
                }
                return;
            }

            // Build embed with all platform data
            const embed = new EmbedBuilder()
                .setTitle('📊 Your Content Creator Progress')
                .setDescription(`Hey <@${userId}>! Here's why you may not have CC yet:`)
                .setColor('#0099ff')
                .setTimestamp()
                .setFooter({ text: 'Data updates every Monday' });

            // Add fields for each platform
            for (const [platform, data] of Object.entries(platformResults)) {
                const field = formatPlatformEmbed(platform, data);
                embed.addFields(field);
            }

            // Add helpful footer
            embed.addFields({
                name: '💡 Tips',
                value: 'Use `/cc-check-progress` anytime to check your progress!\n' +
                       'Make sure your posts use the required hashtags and meet quality standards.',
                inline: false
            });

            await message.reply({ embeds: [embed] });
        } catch (error) {
            console.error('Error in CC progress question listener:', error);
            await message.reply({
                content: 'Sorry, I encountered an error while checking your CC progress. Please try using `/cc-check-progress` instead.'
            }).catch(err => console.error('Failed to send error message:', err));
        }
    }
};
