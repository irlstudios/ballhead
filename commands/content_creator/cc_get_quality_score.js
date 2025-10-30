const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { google } = require('googleapis');
const credentials = require('../../resources/secret.json');

const SPREADSHEET_ID = '15P8BKPbO2DQX6yRXmc9gzuL3iLxfu4ef83Jb8Bi8AJk';
const PLATFORM_SHEETS = [
    { range: 'TikTok Data!A:O', platform: 'TikTok' },
    { range: 'Reels Data!A:O', platform: 'Reels' },
    { range: 'YouTube Data!A:O', platform: 'YouTube' }
];
const PLATFORM_COLORS = {
    TikTok: '#FE2C55',
    Reels: '#E1306C',
    YouTube: '#FF0000',
    default: '#0099ff'
};
const CREATOR_LOOKUP_SHEETS = [
    { range: 'CC Applications!A:Z', platformIndex: 0, idIndex: 2, pIdIndex: 4 },
    { range: 'Base Creators!A:Z', platformIndex: 0, idIndex: 3, pIdIndex: 4 },
    { range: 'Active Creators!A:Z', platformIndex: 0, idIndex: 3, pIdIndex: 4 }
];

// Season start date is stored at Paid Creators!G2 in MM/DD/YYYY format
const SEASON_START_RANGE = 'Paid Creators!G2';

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

function normalizePlatform(value) {
    if (!value) return '';
    const v = value.toString().trim().toLowerCase();
    if (v === 'instagram') return 'Reels';
    if (v === 'ig') return 'Reels';
    if (v === 'reels') return 'Reels';
    if (v === 'tiktok' || v === 'tik tok') return 'TikTok';
    if (v === 'youtube' || v === 'yt') return 'YouTube';
    return value.toString().trim();
}

async function getSheetData() {
    const sheets = google.sheets({ version: 'v4', auth: authorize() });
    const ranges = [
        ...PLATFORM_SHEETS.map(item => item.range),
        ...CREATOR_LOOKUP_SHEETS.map(item => item.range),
        SEASON_START_RANGE
    ];
    const response = await sheets.spreadsheets.values.batchGet({
        spreadsheetId: SPREADSHEET_ID,
        ranges
    });
    const valueRanges = response.data.valueRanges || [];
    const posts = [];
    // Map: discordId -> Map(platform -> pId)
    const creatorIds = new Map();
    let seasonStart = { unix: null, display: 'N/A' };

    valueRanges.forEach((valueRange, index) => {
        if (index < PLATFORM_SHEETS.length) {
            const values = valueRange.values;
            if (!values || values.length < 2) {
                return;
            }
            const platform = PLATFORM_SHEETS[index].platform;
            const rows = values.slice(1);
            rows.forEach(row => {
                posts.push({
                    platform,
                    row
                });
            });
            return;
        }

        const lookupIndex = index - PLATFORM_SHEETS.length;
        if (lookupIndex < CREATOR_LOOKUP_SHEETS.length) {
            const lookupConfig = CREATOR_LOOKUP_SHEETS[lookupIndex];
            const values = valueRange.values;
            if (!values || values.length < 2) {
                return;
            }
            values.slice(1).forEach(row => {
                const platformRaw = row[lookupConfig.platformIndex];
                const discordId = row[lookupConfig.idIndex];
                const pId = row[lookupConfig.pIdIndex];
                if (!discordId || !pId || !platformRaw) {
                    return;
                }
                const normalizedId = normalizeDiscordId(discordId);
                if (!normalizedId) {
                    return;
                }
                const plat = normalizePlatform(platformRaw);
                const pIdTrim = pId.toString().trim();
                if (!pIdTrim) return;
                if (!creatorIds.has(normalizedId)) {
                    creatorIds.set(normalizedId, new Map());
                }
                const byPlat = creatorIds.get(normalizedId);
                if (!byPlat.has(plat)) {
                    byPlat.set(plat, pIdTrim);
                }
            });
            return;
        }

        // Season start date range (Paid Creators!G2)
        const values = valueRange.values;
        const cell = (values && values[0] && values[0][0]) ? values[0][0] : null;
        if (cell) {
            seasonStart = parseDate(cell);
        }
    });

    if (posts.length === 0) {
        throw new Error('No data found in the content creator sheets.');
    }

    return { posts, creatorIds, seasonStart };
}

function parseWeek(value) {
    if (!value) {
        return null;
    }
    const match = value.toString().match(/(\d+)/);
    if (!match) {
        return null;
    }
    const number = parseInt(match[1], 10);
    return Number.isNaN(number) ? null : number;
}

function normalizeDiscordId(value) {
    if (!value) {
        return '';
    }
    const str = value.toString().trim();
    if (!str) {
        return '';
    }
    const match = str.match(/\d{15,20}/);
    if (match) {
        return match[0];
    }
    return str;
}

function parseNumber(value) {
    if (value === undefined || value === null) {
        return null;
    }
    const cleaned = value.toString().replace(/,/g, '').trim();
    if (!cleaned) {
        return null;
    }
    const number = parseFloat(cleaned);
    return Number.isNaN(number) ? null : number;
}

function parseDate(value) {
    if (!value) {
        return { unix: null, display: 'N/A' };
    }
    const trimmed = value.toString().trim();
    if (!trimmed) {
        return { unix: null, display: 'N/A' };
    }
    let date = new Date(trimmed);
    if (Number.isNaN(date.getTime())) {
        const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
        if (match) {
            let year = parseInt(match[3], 10);
            if (year < 100) {
                year += 2000;
            }
            const month = parseInt(match[1], 10) - 1;
            const day = parseInt(match[2], 10);
            date = new Date(Date.UTC(year, month, day, 12, 0, 0));
        }
    }
    if (Number.isNaN(date.getTime())) {
        return { unix: null, display: trimmed };
    }
    const unix = Math.floor(date.getTime() / 1000);
    return { unix, display: `<t:${unix}:D>` };
}

function isValidRow(value) {
    if (!value) {
        return false;
    }
    const normalized = value.toString().toLowerCase().trim();
    return normalized === 'yes' || normalized === 'true' || normalized === '1' || normalized === 'y';
}

function isOnOrAfterDay(unixA, unixB) {
    if (unixA === null || unixB === null) return false;
    const a = new Date(unixA * 1000);
    const b = new Date(unixB * 1000);
    const aDay = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
    const bDay = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
    return aDay >= bDay;
}

function processData(postsData, pIds, platformFilter = null, seasonStartUnix = null) {
    const userData = {
        username: 'Unknown',
        runningAverage: 'N/A',
        weeklyAverages: {},
        posts: [],
        pId: pIds
    };

    let totalQuality = 0;
    let count = 0;
    const weeklyScores = {};
    const embedColor = platformFilter ? (PLATFORM_COLORS[platformFilter] || PLATFORM_COLORS.default) : PLATFORM_COLORS.default;

    const pIdSet = new Set(Array.isArray(pIds) ? pIds.filter(Boolean) : [pIds].filter(Boolean));

    // If we were asked to filter by user ids but none are available, return empty
    if (pIdSet.size === 0) {
        return {
            ...userData,
            embedColor,
            selectedPlatform: platformFilter || null
        };
    }

    postsData.forEach((entry) => {
        const row = entry.row;
        if (!row || row.length === 0) {
            return;
        }
        const platform = entry.platform;
        if (platformFilter && platform.toLowerCase() !== platformFilter.toLowerCase()) {
            return;
        }
        const rowPId = row[1];
        const trimmedPId = rowPId ? rowPId.toString().trim() : '';

        if (!pIdSet.has(trimmedPId)) {
            return;
        }

        // Do not filter by validity; show all posts as requested

        const ownerUsername = row[0];
        const likesCount = row[2];
        const url = row[3];
        const postDate = row[4];
        const caption = row[6];
        const views = row[8];
        const quality = row[11];
        const points = row[12];
        const week = row[14];

        if (ownerUsername) {
            userData.username = ownerUsername.trim();
        }

        const qualityScore = parseNumber(quality);
        const weekNumber = parseWeek(week);
        const likeNumber = parseNumber(likesCount);
        const viewsNumber = parseNumber(views);
        const pointsNumber = parseNumber(points);
        const { unix: postDateUnix, display: postDateDisplay } = parseDate(postDate);

        // Season start gating: include only posts on/after season start
        if (seasonStartUnix && (postDateUnix === null || !isOnOrAfterDay(postDateUnix, seasonStartUnix))) {
            return;
        }

        const qualityRaw = quality !== undefined && quality !== null ? quality.toString().trim() : '';
        const scoreDisplay = qualityScore !== null
            ? qualityScore.toFixed(2)
            : (qualityRaw && /not\s*found/i.test(qualityRaw) ? 'Not Found' : 'Not Found');

        const post = {
            score: scoreDisplay,
            likes: likeNumber !== null ? likeNumber.toLocaleString() : (likesCount ? likesCount.toString().trim() : 'N/A'),
            views: viewsNumber !== null ? viewsNumber.toLocaleString() : (views ? views.toString().trim() : 'N/A'),
            points: pointsNumber !== null ? pointsNumber.toLocaleString() : (points ? points.toString().trim() : 'N/A'),
            details: caption ? caption.trim() : 'No caption provided.',
            week: weekNumber !== null ? weekNumber : null,
            postDateUnix,
            postDateDisplay,
            url: url ? url.trim() : 'N/A',
            platform
        };

        userData.posts.push(post);

        if (qualityScore !== null) {
            totalQuality += qualityScore;
            count += 1;
        }

        if (qualityScore !== null && weekNumber !== null) {
            if (!weeklyScores[weekNumber]) {
                weeklyScores[weekNumber] = { total: 0, count: 0 };
            }
            weeklyScores[weekNumber].total += qualityScore;
            weeklyScores[weekNumber].count += 1;
        }
    });

    userData.posts.sort((a, b) => {
        if (a.postDateUnix && b.postDateUnix) {
            return b.postDateUnix - a.postDateUnix;
        }
        if (a.postDateUnix) {
            return -1;
        }
        if (b.postDateUnix) {
            return 1;
        }
        return 0;
    });

    if (count > 0) {
        userData.runningAverage = (totalQuality / count).toFixed(2);
    }

    Object.keys(weeklyScores).forEach(weekKey => {
        const { total, count: weeklyCount } = weeklyScores[weekKey];
        userData.weeklyAverages[weekKey] = weeklyCount > 0 ? (total / weeklyCount).toFixed(2) : 'N/A';
    });

    const pIdList = Array.from(pIdSet.values()).join(', ');
    console.info(`Processed ${userData.posts.length} posts for creator IDs [${pIdList}] on platform ${platformFilter || 'All Platforms'}.`);

    return {
        ...userData,
        embedColor,
        selectedPlatform: platformFilter || null
    };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('quality-score')
        .setDescription('View your tracked posts for this CC season')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to view posts of')
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('platform')
                .setDescription('The platform to filter posts by')
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
            const userAvatar = targetUser.displayAvatarURL({ dynamic: true });

            const platformOption = interaction.options.getString('platform') || null;

            const { posts, creatorIds, seasonStart } = await getSheetData();
            const lookupKey = normalizeDiscordId(userId);
            const byPlatform = creatorIds.get(lookupKey);

            if (!byPlatform || (byPlatform instanceof Map && byPlatform.size === 0)) {
                await interaction.reply({ content: 'No creator profile found for this user.', ephemeral: true });
                return;
            }

            let pIdsForSearch = [];
            if (platformOption) {
                const plat = normalizePlatform(platformOption);
                const pId = (byPlatform instanceof Map) ? byPlatform.get(plat) : null;
                if (pId) pIdsForSearch = [pId];
            } else {
                if (byPlatform instanceof Map) {
                    pIdsForSearch = Array.from(byPlatform.values());
                }
            }

            const userData = processData(posts, pIdsForSearch, platformOption, seasonStart.unix);

            if (userData.posts.length === 0) {
                const platformText = platformOption ? `on ${platformOption}` : 'across all platforms';
                await interaction.reply({ content: `No posts found for this user ${platformText}.`, ephemeral: true });
                return;
            }

            const currentPage = 1;
            const totalPages = userData.posts.length + 1;
            const overviewEmbed = new EmbedBuilder()
                .setTitle(`${userData.username}'s Quality Scores - Overview`)
                .setThumbnail(userAvatar)
                .setColor(userData.embedColor)
                .addFields(
                    { name: '📈 Running Average (Season)', value: userData.runningAverage.toString(), inline: true },
                    { name: '📊 Total Posts', value: userData.posts.length.toString(), inline: true },
                    { name: '🚀 Season Start', value: seasonStart.display || 'N/A', inline: true }
                );

            if (userData.selectedPlatform) {
                overviewEmbed.addFields({ name: '🪪 Platform', value: userData.selectedPlatform, inline: true });
            }

            const formattedWeeklyFields = Object.entries(userData.weeklyAverages)
                .sort((a, b) => {
                    const weekA = parseWeek(a[0]);
                    const weekB = parseWeek(b[0]);
                    if (weekA === null && weekB === null) {
                        return 0;
                    }
                    if (weekA === null) {
                        return 1;
                    }
                    if (weekB === null) {
                        return -1;
                    }
                    return weekA - weekB;
                })
                .map(([week, score]) => {
                    const weekNumber = parseInt(week, 10);
                    const label = Number.isNaN(weekNumber) ? week : weekNumber;
                    return {
                        name: `📅 Week ${label}`,
                        value: `Average Score: ${score}`,
                        inline: true
                    };
                });

            // Cap weekly fields to stay within Discord's 25 field limit
            const baseFields = 3 + (userData.selectedPlatform ? 1 : 0);
            const maxWeekly = Math.max(0, 25 - baseFields);
            const weeklyToAdd = formattedWeeklyFields.slice(0, maxWeekly);

            if (weeklyToAdd.length > 0) {
                overviewEmbed.addFields(weeklyToAdd);
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
                embedColor: userData.embedColor,
                platform: userData.selectedPlatform,
                seasonStart: seasonStart
            });

            setTimeout(() => {
                interaction.client.commandData.delete(reply.id);
            }, 10 * 60 * 1000);

        } catch (error) {
            console.error(`Error fetching posts: ${error.message}`);

            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: 'An error occurred while fetching posts.', ephemeral: true });
            } else {
                await interaction.editReply({ content: 'An error occurred while fetching posts.' });
            }
        }
    },
};
