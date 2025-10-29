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

const PLATFORMS = {
    tiktok: {
        name: 'TikTok',
        appRange: 'CC Applications!A:G',
        dataRange: 'TikTok Data!A:O',
        activeCreatorsRange: 'Active Creators!A:K',
        paidCreatorsRange: 'Paid Creators!A:F',
        platformKey: 'Tiktok',
        requirements: { followers: 50, weeklyPoints: 8, weeksRequired: 3 },
        color: '#00f2ea',
        emoji: '🎵',
        weekColumnIndex: 14
    },
    youtube: {
        name: 'YouTube',
        appRange: 'CC Applications!A:G',
        dataRange: 'YouTube Data!A:P',
        activeCreatorsRange: 'Active Creators!A:K',
        paidCreatorsRange: 'Paid Creators!A:F',
        platformKey: 'YouTube',
        requirements: { followers: 50, weeklyPoints: 8, weeksRequired: 3 },
        color: '#FF0000',
        emoji: '🎬',
        weekColumnIndex: 15
    },
    reels: {
        name: 'Instagram',
        appRange: 'CC Applications!A:G',
        dataRange: 'Reels Data!A:O',
        activeCreatorsRange: 'Active Creators!A:K',
        paidCreatorsRange: 'Paid Creators!A:F',
        platformKey: 'Reels',
        requirements: { followers: 50, weeklyPoints: 8, weeksRequired: 3 },
        color: '#E1306C',
        emoji: '📸',
        weekColumnIndex: 14
    }
};

const DATE_FORMATS = ['M/D/YY', 'MM/DD/YY', 'M/D/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'YYYY/MM/DD'];

function parseSeasonWeek(value) {
    if (!value) return null;
    const match = value.toString().match(/(\d+)/);
    if (!match) return null;
    const number = parseInt(match[1], 10);
    return Number.isNaN(number) ? null : number;
}

function parseSpreadsheetDate(value) {
    if (!value) return null;
    const trimmed = value.toString().trim();
    if (!trimmed) return null;
    let parsed = moment(trimmed, DATE_FORMATS, true);
    if (!parsed.isValid()) {
        parsed = moment(trimmed);
    }
    return parsed.isValid() ? parsed : null;
}

function describeRelativeWeek(timestamp) {
    if (!timestamp) return null;
    const reference = moment(timestamp).startOf('week');
    const now = moment().startOf('week');
    const diff = now.diff(reference, 'weeks');
    if (diff <= 0) return 'This week';
    if (diff === 1) return 'Last week';
    return `${diff} weeks ago`;
}

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

        let activeCreatorRow = null;
        let paidCreatorRow = null;

        for (const row of activeRows) {
            if (row && row.length > 4) {
                const rowPlatform = row[0]?.trim();
                const rowDiscordId = row[3]?.trim();
                if (rowPlatform?.toLowerCase() === config.platformKey.toLowerCase() &&
                    rowDiscordId === discordId) {
                    activeCreatorRow = row;
                    break;
                }
            }
        }

        for (const row of paidRows) {
            if (row && row.length > 3) {
                const rowPlatform = row[1]?.trim();
                const rowDiscordId = row[3]?.trim();
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

function analyzeWeeklyProgress(userPosts, config) {
    if (!userPosts || userPosts.length === 0) {
        return {
            followers: 'N/A',
            weeklyStats: {},
            consecutiveWeeksMet: 0,
            totalValidPosts: 0,
            allWeeks: [],
            weekDetails: {}
        };
    }

    const followerCount = userPosts[0]?.[5] || 'N/A';

    const weeklyStats = {};
    const weekDetails = {};
    let totalValidPosts = 0;
    let encounterIndex = 0;

    const weekColIndex = config.weekColumnIndex || 14;

    for (const post of userPosts) {
        if (!post || post.length <= weekColIndex) continue;

        const seasonWeek = post[weekColIndex]?.toString().trim();
        if (!seasonWeek || seasonWeek === 'TRUE' || seasonWeek === 'FALSE') continue;

        const pointsEarned = parseFloat(post[12]) || 0;
        const isValid = post[13]?.trim()?.toLowerCase() === 'true' || post[13]?.trim() === 'TRUE';
        const qualityScore = parseFloat(post[11]) || 0;
        const postMoment = parseSpreadsheetDate(post[4]);
        const timestamp = postMoment ? postMoment.valueOf() : null;

        if (!weeklyStats[seasonWeek]) {
            weeklyStats[seasonWeek] = {
                totalPoints: 0,
                validPosts: 0,
                totalPosts: 0,
                avgQuality: 0,
                qualitySum: 0,
                earliestTimestamp: timestamp,
                latestTimestamp: timestamp,
                encounterIndex,
                parsedWeek: parseSeasonWeek(seasonWeek)
            };
            encounterIndex++;
        }

        const stats = weeklyStats[seasonWeek];

        stats.totalPosts++;

        if (timestamp !== null) {
            if (stats.earliestTimestamp === null || timestamp < stats.earliestTimestamp) {
                stats.earliestTimestamp = timestamp;
            }
            if (stats.latestTimestamp === null || timestamp > stats.latestTimestamp) {
                stats.latestTimestamp = timestamp;
            }
        }

        if (isValid) {
            stats.totalPoints += pointsEarned;
            stats.validPosts++;
            stats.qualitySum += qualityScore;
            totalValidPosts++;
        }
    }

    const weekEntries = Object.keys(weeklyStats).map(weekKey => {
        const stats = weeklyStats[weekKey];
        if (stats.validPosts > 0) {
            stats.avgQuality = (stats.qualitySum / stats.validPosts).toFixed(2);
        } else {
            stats.avgQuality = '0.00';
        }
        const sortTimestamp = stats.latestTimestamp ?? stats.earliestTimestamp ?? null;
        weekDetails[weekKey] = {
            latestTimestamp: stats.latestTimestamp,
            earliestTimestamp: stats.earliestTimestamp
        };
        return {
            week: weekKey,
            stats,
            sortTimestamp,
            parsedWeek: stats.parsedWeek,
            encounterIndex: stats.encounterIndex
        };
    });

    weekEntries.sort((a, b) => {
        const aTs = a.sortTimestamp;
        const bTs = b.sortTimestamp;
        if (aTs !== null && bTs !== null && aTs !== bTs) {
            return aTs - bTs;
        }
        if (aTs !== null && bTs === null) {
            return -1;
        }
        if (aTs === null && bTs !== null) {
            return 1;
        }
        const aWeek = a.parsedWeek;
        const bWeek = b.parsedWeek;
        if (aWeek !== null && bWeek !== null && aWeek !== bWeek) {
            return aWeek - bWeek;
        }
        return a.encounterIndex - b.encounterIndex;
    });

    // Calculate consecutive weeks by working backwards from the most recent week
    // Only count streaks that are current/recent (not historical streaks from months ago)
    let consecutiveWeeksFromEnd = 0;
    for (let i = weekEntries.length - 1; i >= 0; i--) {
        if (weekEntries[i].stats.totalPoints >= 8) {
            consecutiveWeeksFromEnd++;
        } else {
            // Stop counting when we hit a week that doesn't meet requirements
            break;
        }
    }

    const allWeeks = weekEntries.map(entry => entry.week);

    return {
        followers: followerCount,
        weeklyStats,
        consecutiveWeeksMet: consecutiveWeeksFromEnd,
        totalValidPosts,
        allWeeks,
        weekDetails
    };
}

function formatPlatformEmbed(platform, platformData) {
    const { appRow, userPosts, activeCreatorRow, paidCreatorRow, config } = platformData;

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

    if (Object.keys(progress.weeklyStats).length === 0) {
        return {
            name: `${config.emoji} ${config.name}`,
            value: `✅ Applied on ${appDate.format('MMM D, YYYY')}\n⏳ No valid posts with week assignments yet.`,
            inline: false
        };
    }

    const allWeeksWithData = progress.allWeeks;
    const weekDetails = progress.weekDetails || {};

    // Filter to only include weeks from the last 3 weeks (chronologically)
    const recentWeeks = allWeeksWithData.filter(weekKey => {
        const detail = weekDetails[weekKey] || {};
        const referenceTimestamp = detail.latestTimestamp ?? detail.earliestTimestamp ?? null;
        if (!referenceTimestamp) return false;

        // Calculate how many weeks ago this week was
        const reference = moment(referenceTimestamp).startOf('week');
        const now = moment().startOf('week');
        const weeksAgo = now.diff(reference, 'weeks');

        // Only include weeks within the last 3 weeks (0, 1, 2, or 3 weeks ago)
        return weeksAgo <= 3;
    });

    for (const weekKey of recentWeeks) {
        const stats = progress.weeklyStats[weekKey];
        const metRequirement = stats.totalPoints >= req.weeklyPoints;
        const status = metRequirement ? '✅' : '❌';
        const detail = weekDetails[weekKey] || {};
        const referenceTimestamp = detail.latestTimestamp ?? detail.earliestTimestamp ?? null;
        const relativeLabel = describeRelativeWeek(referenceTimestamp);
        const dateLabel = referenceTimestamp ? moment(referenceTimestamp).format('MMM D, YYYY') : null;
        let heading = `Week ${weekKey}`;
        if (relativeLabel) {
            heading = `${relativeLabel} · Week ${weekKey}`;
        }
        if (dateLabel) {
            heading += ` · ${dateLabel}`;
        }

        statusLines.push(
            `**${heading}:** ${status}\n` +
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
        if (message.author.bot) return;
        if (message.channel.isDMBased()) return;

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

            for (const [key, config] of Object.entries(PLATFORMS)) {
                const data = await getPlatformData(key, userId);
                if (data && data.appRow) {
                    platformResults[key] = data;
                } else if (data && (data.activeCreatorRow || data.paidCreatorRow)) {
                    existingCCPlatforms.push(config.name);
                }
            }

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

            const embed = new EmbedBuilder()
                .setTitle('📊 Your Content Creator Progress')
                .setDescription(`Hey <@${userId}>! Here's why you may not have CC yet:`)
                .setColor('#0099ff')
                .setTimestamp()
                .setFooter({ text: 'Data updates every Monday' });

            for (const [platform, data] of Object.entries(platformResults)) {
                const field = formatPlatformEmbed(platform, data);
                embed.addFields(field);
            }

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
