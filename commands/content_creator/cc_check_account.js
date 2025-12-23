const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const moment = require('moment');
const { getSheetsClient, getCachedValues } = require('../../utils/sheets_cache');
const sheetId = '1ZFLMKI7kytkUXU0lDKXDGSuNFn4OqZYnpyLIe6urVLI';
const SHEET_CACHE_TTL_MS = 1800000; // 30 minutes (data updates weekly)

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

function buildAccountUrl(platform, username, platformId) {
    const normalize = (u) => {
        if (!u) return null;
        const t = u.toString().trim();
        return t.startsWith('@') ? t.slice(1) : t;
    };

    const user = normalize(username);

    switch (platform) {
        case 'tiktok':
            return user ? `https://www.tiktok.com/@${user}` : null;
        case 'youtube':
            if (platformId && platformId.toString().trim().startsWith('UC')) {
                return `https://www.youtube.com/channel/${platformId.toString().trim()}`;
            }
            return user ? `https://www.youtube.com/@${user}` : null;
        case 'reels': // Instagram Reels
            return user ? `https://www.instagram.com/${user}/` : null;
        default:
            return null;
    }
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

function getPlatformData(platform, discordId, valuesByRange) {
    try {
        const config = PLATFORMS[platform];

        const appRows = valuesByRange.get(config.appRange) || [];
        const dataRows = valuesByRange.get(config.dataRange) || [];
        const activeRows = valuesByRange.get(config.activeCreatorsRange) || [];
        const paidRows = valuesByRange.get(config.paidCreatorsRange) || [];

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
    // Only count streaks that are current/recent and actually consecutive (no gaps)
    let consecutiveWeeksFromEnd = 0;
    for (let i = weekEntries.length - 1; i >= 0; i--) {
        const currentEntry = weekEntries[i];

        // Check if this week meets the points requirement
        if (currentEntry.stats.totalPoints >= 8) {
            // If this is not the first week we're counting, verify it's consecutive with the previous
            if (consecutiveWeeksFromEnd > 0 && i < weekEntries.length - 1) {
                const nextEntry = weekEntries[i + 1];

                // Check if weeks are consecutive by comparing timestamps (should be ~1 week apart)
                // or by comparing parsed week numbers (should be sequential)
                const currentTimestamp = currentEntry.sortTimestamp;
                const nextTimestamp = nextEntry.sortTimestamp;

                if (currentTimestamp && nextTimestamp) {
                    const weeksDiff = moment(nextTimestamp).diff(moment(currentTimestamp), 'weeks', true);
                    // Allow some tolerance (between 0.5 and 1.5 weeks apart)
                    if (weeksDiff < 0.5 || weeksDiff > 1.5) {
                        // Gap detected - not consecutive
                        break;
                    }
                } else if (currentEntry.parsedWeek !== null && nextEntry.parsedWeek !== null) {
                    // Check if parsed week numbers are sequential
                    if (nextEntry.parsedWeek - currentEntry.parsedWeek !== 1) {
                        // Gap detected - not consecutive
                        break;
                    }
                }
            }

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

    const username = appRow?.[1]?.trim();
    const platformId = platformData.platformId;
    const accountUrl = buildAccountUrl(platform, username, platformId);
    const accountLine = accountUrl ? `**Account:** ${accountUrl}\n` : '';

    const isActiveCreator = activeCreatorRow !== null;
    const isPaidCreator = paidCreatorRow !== null;

    if (isActiveCreator || isPaidCreator) {
        const ccType = isPaidCreator ? 'Paid' : 'Active';
        return {
            name: `${config.emoji} ${config.name}`,
            value: accountLine +
                   '😄 You\'re already a ' + ccType + ' Content Creator for ' + config.name + ', silly!\n\n' +
                   'Keep posting great content and check out `/quality-score` to see your tracked posts.',
            inline: false
        };
    }

    const appDateStr = appRow[3];
    if (!appDateStr) {
        return {
            name: `${config.emoji} ${config.name}`,
            value: accountLine + '⚠️ Application found but date is missing. Contact support.',
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
            value: accountLine + `✅ Applied on ${appDate.format('MMM D, YYYY')}\n⏳ No posts tracked yet. Check back <t:${nextMonday.unix()}:R>`,
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
            value: accountLine + `✅ Applied on ${appDate.format('MMM D, YYYY')}\n⏳ No valid posts with week assignments yet.`,
            inline: false
        };
    }

    // Build calendar-based weeks: Last week, 2 weeks ago, 3 weeks ago
    // These are ALWAYS based on the current date, not user data
    const now = moment();
    const calendarWeeks = [];

    for (let weeksAgo = 1; weeksAgo <= 3; weeksAgo++) {
        const weekStart = moment().subtract(weeksAgo, 'weeks').startOf('week');
        const weekEnd = moment().subtract(weeksAgo, 'weeks').endOf('week');

        calendarWeeks.push({
            weeksAgo,
            weekStart,
            weekEnd,
            timestamp: weekStart.valueOf()
        });
    }

    // For each calendar week, aggregate the user's posts that fall in that time range
    const calendarWeekStats = calendarWeeks.map(calWeek => {
        let totalPoints = 0;
        let validPosts = 0;
        let totalPosts = 0;
        let qualitySum = 0;

        // Go through all user posts and find ones that fall in this calendar week
        for (const post of userPosts) {
            const postMoment = parseSpreadsheetDate(post[4]);
            if (!postMoment) continue;

            // Check if post falls within this calendar week
            if (postMoment.isBetween(calWeek.weekStart, calWeek.weekEnd, null, '[]')) {
                const pointsEarned = parseFloat(post[12]) || 0;
                const isValid = post[13]?.trim()?.toLowerCase() === 'true' || post[13]?.trim() === 'TRUE';
                const qualityScore = parseFloat(post[11]) || 0;

                totalPosts++;
                if (isValid) {
                    totalPoints += pointsEarned;
                    validPosts++;
                    qualitySum += qualityScore;
                }
            }
        }

        const avgQuality = validPosts > 0 ? (qualitySum / validPosts).toFixed(2) : '0.00';

        return {
            weeksAgo: calWeek.weeksAgo,
            totalPoints,
            validPosts,
            totalPosts,
            avgQuality,
            timestamp: calWeek.timestamp,
            weekStart: calWeek.weekStart,
            weekEnd: calWeek.weekEnd
        };
    });

    // Reverse so oldest week is first (3 weeks ago, 2 weeks ago, last week)
    calendarWeekStats.reverse();

    for (const weekStat of calendarWeekStats) {
        const metRequirement = weekStat.totalPoints >= req.weeklyPoints;
        const status = metRequirement ? '✅' : '❌';

        const relativeLabel = describeRelativeWeek(weekStat.timestamp);
        const dateLabel = moment(weekStat.weekStart).format('MMM D, YYYY');
        const heading = `${relativeLabel} · ${dateLabel}`;

        statusLines.push(
            `**${heading}:** ${status}\n` +
            `Points: \`${weekStat.totalPoints.toFixed(1)}\` | Valid Posts: \`${weekStat.validPosts}\` | Avg Quality: \`${weekStat.avgQuality}\``
        );
    }

    // Calculate consecutive weeks from the calendar-based stats
    let consecutiveWeeksFromEnd = 0;
    for (let i = calendarWeekStats.length - 1; i >= 0; i--) {
        if (calendarWeekStats[i].totalPoints >= req.weeklyPoints) {
            consecutiveWeeksFromEnd++;
        } else {
            break;
        }
    }

    const followerCount = parseInt(progress.followers);
    const meetsFollowerReq = !isNaN(followerCount) && followerCount >= req.followers;
    const followerStatus = meetsFollowerReq ? '✅' : '❌';

    const meetsConsecutiveReq = consecutiveWeeksFromEnd >= req.weeksRequired;
    const consecutiveStatus = meetsConsecutiveReq ? '✅' : '❌';

    let statusHeader = '';
    if (meetsFollowerReq && meetsConsecutiveReq) {
        statusHeader = '🎉 **Eligible for Content Creator Role!**\n\n';
    }

    return {
        name: `${config.emoji} ${config.name}`,
        value: accountLine +
               statusHeader +
               `**${followerLabel}:** ${progress.followers} ${followerStatus} (need ${req.followers})\n` +
               `**Consecutive Weeks (${req.weeklyPoints}+ pts):** ${consecutiveWeeksFromEnd}/${req.weeksRequired} ${consecutiveStatus}\n` +
               `**Requirements:** ${req.weeklyPoints} points/week for ${req.weeksRequired} consecutive weeks\n\n` +
               statusLines.join('\n\n'),
        inline: false
    };
}

const MODERATOR_ROLES = [
    '805833778064130104',
    '939634611909185646',
    '1258042039895986249'
];

function canCheckOthers(member) {
    if (!member || !member.roles) return false;
    return MODERATOR_ROLES.some(roleId => member.roles.cache.has(roleId));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('cc-check-progress')
        .setDescription('Check your Content Creator application status and requirements progress across all platforms')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('(Moderator only) Check another user\'s progress')
                .setRequired(false)
        ),
    async execute(interaction) {
        const cmdStartTime = Date.now();
        try {
            await interaction.deferReply({ ephemeral: false });

            const sheetsStartTime = Date.now();
            const sheets = await getSheetsClient();
            console.log(`[cc-check-progress] Sheets client ready in ${Date.now() - sheetsStartTime}ms`);
            const rangesToFetch = Array.from(new Set(
                Object.values(PLATFORMS).flatMap(config => ([
                    config.appRange,
                    config.dataRange,
                    config.activeCreatorsRange,
                    config.paidCreatorsRange
                ]))
            ));
            const cacheStartTime = Date.now();
            const valuesByRange = await getCachedValues({
                sheets,
                spreadsheetId: sheetId,
                ranges: rangesToFetch,
                ttlMs: SHEET_CACHE_TTL_MS
            });
            console.log(`[cc-check-progress] Data fetched in ${Date.now() - cacheStartTime}ms`);

            const processingStartTime = Date.now();
            const targetUser = interaction.options.getUser('user');
            const isModerator = canCheckOthers(interaction.member);

            // If they're trying to check someone else but aren't a moderator, deny
            if (targetUser && !isModerator) {
                await interaction.editReply({
                    content: 'You don\'t have permission to check other users\' progress. You can only check your own progress.',
                    ephemeral: true
                });
                return;
            }

            // Determine whose progress to check
            const userId = targetUser ? targetUser.id : interaction.user.id;
            const isCheckingOther = targetUser && targetUser.id !== interaction.user.id;
            const platformResults = {};
            const existingCCPlatforms = [];

            for (const [key, config] of Object.entries(PLATFORMS)) {
                const data = getPlatformData(key, userId, valuesByRange);
                if (data && data.appRow) {
                    platformResults[key] = data;
                } else if (data && (data.activeCreatorRow || data.paidCreatorRow)) {
                    existingCCPlatforms.push(config.name);
                }
            }

            if (Object.keys(platformResults).length === 0) {
                if (existingCCPlatforms.length > 0) {
                    const pronoun = isCheckingOther ? 'They\'re' : 'You\'re';
                    const possessive = isCheckingOther ? 'their' : 'your';
                    await interaction.editReply({
                        content: `${isCheckingOther ? `<@${userId}> is` : 'Looks like you\'re'} already a CC, silly! 😄\n\n` +
                                 `${pronoun} a Content Creator for: **${existingCCPlatforms.join(', ')}**\n\n` +
                                 `${pronoun} also don't have any open applications to other platforms.`
                    });
                } else {
                    await interaction.editReply({
                        content: `${isCheckingOther ? `<@${userId}> hasn't` : 'You haven\'t'} applied for any CC programs yet.\n\n` +
                                 `${isCheckingOther ? 'They need' : 'Use'} ${isCheckingOther ? 'to use' : ''} \`/tiktok-cc-apply\`, \`/youtube-cc-apply\`, or \`/instagram-cc-apply\` to get started!`
                    });
                }
                return;
            }

            const embed = new EmbedBuilder()
                .setTitle(`📊 ${isCheckingOther ? `${targetUser.username}'s` : 'Your'} Content Creator Progress`)
                .setDescription(`${isCheckingOther ? `Here's <@${userId}>'s` : 'Here\'s your'} current status across all platforms ${isCheckingOther ? 'they\'ve' : 'you\'ve'} applied to:`)
                .setColor('#0099ff')
                .setTimestamp()
                .setFooter({ text: 'Data updates every Monday' });

            for (const [platform, data] of Object.entries(platformResults)) {
                const field = formatPlatformEmbed(platform, data);
                embed.addFields(field);
            }

            await interaction.editReply({ embeds: [embed] });

            const totalTime = Date.now() - cmdStartTime;
            const processingTime = Date.now() - processingStartTime;
            console.log(`[cc-check-progress] Processing completed in ${processingTime}ms | Total: ${totalTime}ms`);
        } catch (error) {
            console.error('Error in cc-check-progress:', error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: 'An unexpected error occurred while processing your request.',
                    ephemeral: true
                });
            } else {
                await interaction.editReply({
                    content: 'An unexpected error occurred while processing your request.',
                    ephemeral: true
                });
            }
        }
    }
};
