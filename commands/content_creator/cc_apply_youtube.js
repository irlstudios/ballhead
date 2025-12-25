const {SlashCommandBuilder} = require('@discordjs/builders');
const {EmbedBuilder} = require('discord.js');
const {fetchCreatorData} = require('../../API/apifyClient');
const { getSheetsClient } = require('../../utils/sheets_cache');

function formatDate(value) {
    if (value === undefined || value === null) {
        return '';
    }
    let date;
    if (value instanceof Date) {
        date = new Date(value.getTime());
    } else if (typeof value === 'string') {
        date = new Date(value);
    } else {
        const numeric = Number(value);
        if (Number.isNaN(numeric)) {
            return '';
        }
        date = numeric >= 1e12 ? new Date(numeric) : new Date(numeric * 1000);
    }
    if (Number.isNaN(date.getTime())) {
        return '';
    }
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const year = date.getUTCFullYear();
    return `${month}/${day}/${year}`;
}

function extractRowNumber(range) {
    if (!range) {
        return null;
    }
    const match = range.match(/![A-Z]+(\d+)/);
    if (!match) {
        return null;
    }
    return Number(match[1]);
}

function durationToSeconds(value) {
    if (!value) {
        return '';
    }
    if (typeof value === 'number' && !Number.isNaN(value)) {
        return value;
    }
    const trimmed = String(value).trim();
    if (!trimmed) {
        return '';
    }
    const parts = trimmed.split(':').map(Number);
    if (parts.some(part => Number.isNaN(part))) {
        return '';
    }
    let seconds = 0;
    let multiplier = 1;
    for (let i = parts.length - 1; i >= 0; i -= 1) {
        seconds += parts[i] * multiplier;
        multiplier *= 60;
    }
    return seconds;
}

function isApifyLimitError(error) {
    const payload = error?.response?.data || error;
    const inner = payload?.error || payload;
    const type = inner?.type;
    const message = inner?.message;
    if (type === 'platform-feature-disabled') {
        return true;
    }
    return typeof message === 'string' && message.toLowerCase().includes('hard limit exceeded');
}

async function logPendingApplication({sheets, platformLabel, username, interaction, profileUrl, logChannelId}) {
    const nowStamp = formatDate(new Date());
    try {
        await sheets.spreadsheets.values.append({
            spreadsheetId: '1ZFLMKI7kytkUXU0lDKXDGSuNFn4OqZYnpyLIe6urVLI',
            range: `'CC Applications'!A:F`,
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            resource: {values: [[platformLabel, username, interaction.user.id, nowStamp, '', profileUrl]]}
        });
    } catch (appendError) {
        console.error(`Failed to log ${platformLabel} application after Apify limit hit:`, appendError);
    }
    if (logChannelId) {
        const logChannel = interaction.client.channels.cache.get(logChannelId);
        if (logChannel) {
            const logEmbed = new EmbedBuilder()
                .setTitle(`${platformLabel} CC Application (Queued)`)
                .setDescription(`User: ${interaction.user.username} (${interaction.user.id})\n${platformLabel}: ${profileUrl}\nStatus: Pending - Apify monthly limit reached`)
                .setColor('#FFA500');
            logChannel.send({embeds: [logEmbed]});
        }
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('youtube-cc-apply')
        .setDescription('Apply for the YouTube Content Creator role')
        .addStringOption(option =>
            option.setName('handle')
                .setDescription('Your YouTube username or link')
                .setRequired(true)),
    async execute(interaction) {
        const handle = interaction.options.getString('handle');
        const userRoles = interaction.member.roles.cache;
        const prospect_role = '1094048523844063313';

        const requiredRoles = [
            '924522770057031740',
            '924522921370714152',
            '924522979768016946',
            '924523044268032080',
            '1242262635223715971',
            '925177626644058153',
            '1087071951270453278',
            '1223408044784746656'
        ];

        if (!requiredRoles.some(role => userRoles.has(role))) {
            return interaction.reply({content: 'You do not have the required role to apply.', ephemeral: true});
        }

        const youtubeRegex = /^(?:https?:\/\/(?:www\.)?youtube\.com\/(?:@|channel\/|c\/|user\/)?([\w.-]+)|([\w.-]+))$/;
        const match = handle.match(youtubeRegex);
        if (!match) {
            const embed = new EmbedBuilder()
                .setTitle('Invalid Format')
                .setDescription('Invalid YouTube username or link format. Accepted formats are:\n`exampleusername`\n`@exampleusername`\n`https://www.youtube.com/@exampleusername`\n`https://www.youtube.com/channel/UCzvtjvh8GODN_yIm-Gz8vbw`')
                .setColor('#FF0000');
            return interaction.reply({embeds: [embed], ephemeral: true});
        }

        let youtubeUsername = match[1] || match[2];
        let youtubeUrl;
        if (youtubeUsername.startsWith('@')) {
            youtubeUrl = `https://www.youtube.com/${youtubeUsername}`;
        } else if (youtubeUsername.startsWith('UC')) {
            youtubeUrl = `https://www.youtube.com/channel/${youtubeUsername}`;
        } else if (youtubeUsername.startsWith('c/') || youtubeUsername.startsWith('user/')) {
            youtubeUrl = `https://www.youtube.com/${youtubeUsername}`;
        } else {
            youtubeUrl = `https://www.youtube.com/@${youtubeUsername}`;
        }

        await interaction.deferReply({ephemeral: true});
        const cleanUsername = youtubeUsername.replace(/^@+/, '');
        const cleanUsernameLower = cleanUsername.toLowerCase();
        const normalizedYoutubeUrl = youtubeUrl.replace(/\/+$/, '').toLowerCase();

        let apifyPromise;
        let apifyLimitHit = false;
        let apifyLimitHandled = false;
        try {
            const apifyInput = {
                startUrls: [
                    {
                        url: youtubeUrl
                    }
                ],
                maxShorts: 30,
                maxVideos: 30,
                maxStreams: 0,
                maxResults: 100,
                maxResultsShorts: 30,
                maxResultStreams: 0,
                subtitlesLanguage: 'en',
                subtitlesFormat: 'srt'
            };
            apifyPromise = fetchCreatorData('youtube', {
                handle: cleanUsername,
                url: youtubeUrl,
                userId: interaction.user.id,
                input: apifyInput
            });
        } catch (error) {
            if (isApifyLimitError(error)) {
                apifyLimitHit = true;
                console.error('Apify YouTube fetch skipped due to monthly limit:', error.response?.data || error.message || error);
            } else {
                console.error('Apify YouTube fetch failed to start:', error.response?.data || error.message || error);
            }
        }

        const sheets = await getSheetsClient();
        try {
            const existingResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: '1ZFLMKI7kytkUXU0lDKXDGSuNFn4OqZYnpyLIe6urVLI',
                range: '\'CC Applications\'!A:C'
            });
            const existingRows = existingResponse.data?.values || [];
            const rowsOnly = existingRows.length > 1 ? existingRows.slice(1) : [];
            const duplicate = rowsOnly.some(row => {
                if (!row || row.length < 3) {
                    return false;
                }
                const [platform, username, userId] = row;
                if (!platform || !userId) {
                    return false;
                }
                if (platform.trim().toLowerCase() !== 'youtube') {
                    return false;
                }
                if (userId.trim() !== interaction.user.id) {
                    return false;
                }
                const normalizedUsername = username ? username.trim().toLowerCase() : '';
                return !normalizedUsername || normalizedUsername === cleanUsernameLower;
            });
            if (duplicate) {
                await interaction.editReply({
                    content: 'We already have your YouTube application on file. No need to reapply—keep posting quality content and use `/check-youtube-account` plus `/quality-score` to track your progress.',
                    ephemeral: true
                });
                return;
            }
        } catch (lookupError) {
            console.error('Failed to check for existing YouTube application:', lookupError);
            await interaction.editReply({
                content: 'We had trouble verifying whether you already applied. Please try again later or contact staff if the issue persists.',
                ephemeral: true
            });
            return;
        }

        // Sheet append will happen after successful verification

        await interaction.editReply({content: 'Your application is being processed. We will follow up in your DMs once verification finishes.'});
        await interaction.member.roles.add(prospect_role);

        const notifyUser = async (message) => {
            try {
                await interaction.user.send({content: message});
            } catch (dmError) {
                console.error('Failed to send YouTube application DM:', dmError);
            }
        };

        const handleApifyLimitExceeded = async () => {
            if (apifyLimitHandled) {
                return;
            }
            apifyLimitHandled = true;
            await logPendingApplication({
                sheets,
                platformLabel: 'YouTube',
                username: cleanUsername,
                interaction,
                profileUrl: youtubeUrl,
                logChannelId: '1098354875324174477'
            });
            await notifyUser(
                [
                    '⏳ We added your YouTube application to the queue.',
                    'We will review and fetch your data this Sunday.',
                    `Link on file: ${youtubeUrl}`,
                    '',
                    'No further action is needed from you. Thanks for your patience!'
                ].join('\n')
            );
        };

        if (apifyLimitHit) {
            await handleApifyLimitExceeded();
            return;
        }

        if (apifyPromise) {
            apifyPromise.then(async (data) => {
                const status = data?.status;
                const items = Array.isArray(data?.items) ? data.items : [];
                const matchedItem = items.find(item => {
                    const channelUrl = item?.channelUrl ? item.channelUrl.replace(/\/+$/, '').toLowerCase() : '';
                    const inputUrl = item?.input ? item.input.replace(/\/+$/, '').toLowerCase() : '';
                    const channelUsername = item?.channelUsername ? item.channelUsername.toLowerCase() : '';
                    return channelUrl === normalizedYoutubeUrl || inputUrl === normalizedYoutubeUrl || channelUsername === cleanUsernameLower;
                });
                if (status === 'SUCCEEDED' && matchedItem) {
                    const channelId = matchedItem.aboutChannelInfo?.channelId || matchedItem.channelId || '';
                    const channelUrl = matchedItem.aboutChannelInfo?.channelUrl || matchedItem.channelUrl || youtubeUrl;
                    const subscribers = matchedItem.aboutChannelInfo?.numberOfSubscribers != null ? matchedItem.aboutChannelInfo.numberOfSubscribers : '';
                    // Append to sheet only after successful verification
                    const nowStamp = formatDate(new Date());
                    const baseValues = [[
                        'YouTube',
                        cleanUsername,
                        interaction.user.id,
                        nowStamp
                    ]];
                    let appendedRange;
                    try {
                        const appendResponse = await sheets.spreadsheets.values.append({
                            spreadsheetId: '1ZFLMKI7kytkUXU0lDKXDGSuNFn4OqZYnpyLIe6urVLI',
                            range: `'CC Applications'!A:D`,
                            valueInputOption: 'USER_ENTERED',
                            resource: { values: baseValues },
                            insertDataOption: 'INSERT_ROWS',
                            includeValuesInResponse: true
                        });
                        appendedRange = appendResponse.data?.updates?.updatedRange;
                    } catch (error) {
                        console.error('Error logging verified application to Google Sheets:', error);
                    }

                    const logChannel = interaction.client.channels.cache.get('1098354875324174477');
                    if (logChannel) {
                        const logEmbed = new EmbedBuilder()
                            .setTitle('New YouTube CC Application')
                            .setDescription(`User: ${interaction.user.username} (${interaction.user.id})\nYouTube: ${youtubeUrl}`)
                            .setColor('#00ff00');
                        logChannel.send({embeds: [logEmbed]});
                    }
                    const accountVideos = items.filter(item => {
                        if (item?.type && item.type !== 'video' && item.type !== 'shorts') {
                            return false;
                        }
                        if (channelId && (item.aboutChannelInfo?.channelId || item.channelId)) {
                            return (item.aboutChannelInfo?.channelId || item.channelId) === channelId;
                        }
                        const channelUrlLower = item?.channelUrl ? item.channelUrl.replace(/\/+$/, '').toLowerCase() : '';
                        const inputUrlLower = item?.input ? item.input.replace(/\/+$/, '').toLowerCase() : '';
                        return channelUrlLower === normalizedYoutubeUrl || inputUrlLower === normalizedYoutubeUrl;
                    });
                    if (appendedRange) {
                        const rowNumber = extractRowNumber(appendedRange);
                        if (rowNumber) {
                            const prev = rowNumber - 1;
                            const eVal = channelId;
                            const fVal = channelUrl;
                            const gVal = subscribers;

                            const hFormula = `=J${rowNumber}+O${rowNumber}+T${rowNumber}`;
                            const iDate = `=I${prev}`;
                            const jFormula = `=COUNTIFS(INDIRECT("'" & A${rowNumber} & " Data'!B:B"), E${rowNumber}, ARRAYFORMULA(DATEVALUE(INDIRECT("'" & A${rowNumber} & " Data'!E:E"))), ">=" & I${rowNumber}, ARRAYFORMULA(DATEVALUE(INDIRECT("'" & A${rowNumber} & " Data'!E:E"))), "<=" & N${rowNumber}, INDIRECT("'" & A${rowNumber} & " Data'!J:J"), TRUE)`;
                            const kFormula = `=IFERROR(ROUND(AVERAGEIFS(INDIRECT("'" & A${rowNumber} & " Data'!C:C"), INDIRECT("'" & A${rowNumber} & " Data'!B:B"), E${rowNumber}, ARRAYFORMULA(DATEVALUE(INDIRECT("'" & A${rowNumber} & " Data'!E:E"))), ">=" & I${rowNumber}, ARRAYFORMULA(DATEVALUE(INDIRECT("'" & A${rowNumber} & " Data'!E:E"))), "<=" & N${rowNumber}, INDIRECT("'" & A${rowNumber} & " Data'!J:J"), TRUE)), 0)`;
                            const lFormula = `=IFERROR(ROUND(AVERAGEIFS(INDIRECT("'" & A${rowNumber} & " Data'!L:L"), INDIRECT("'" & A${rowNumber} & " Data'!B:B"), E${rowNumber}, ARRAYFORMULA(DATEVALUE(INDIRECT("'" & A${rowNumber} & " Data'!E:E"))), ">=" & I${rowNumber}, ARRAYFORMULA(DATEVALUE(INDIRECT("'" & A${rowNumber} & " Data'!E:E"))), "<=" & N${rowNumber}, INDIRECT("'" & A${rowNumber} & " Data'!J:J"), TRUE)), 0)`;
                            const mFormula = `=SUMIFS(INDIRECT("'" & A${rowNumber} & " Data'!M:M"), INDIRECT("'" & A${rowNumber} & " Data'!B:B"), E${rowNumber}, ARRAYFORMULA(DATEVALUE(INDIRECT("'" & A${rowNumber} & " Data'!E:E"))), ">=" & I${rowNumber}, ARRAYFORMULA(DATEVALUE(INDIRECT("'" & A${rowNumber} & " Data'!E:E"))), "<=" & N${rowNumber}, INDIRECT("'" & A${rowNumber} & " Data'!J:J"), TRUE)`;
                            const nDate = `=N${prev}`;
                            const oFormula = `=COUNTIFS(INDIRECT("'" & A${rowNumber} & " Data'!B:B"), E${rowNumber}, ARRAYFORMULA(DATEVALUE(INDIRECT("'" & A${rowNumber} & " Data'!E:E"))), ">=" & N${rowNumber}, ARRAYFORMULA(DATEVALUE(INDIRECT("'" & A${rowNumber} & " Data'!E:E"))), "<=" & S${rowNumber}, INDIRECT("'" & A${rowNumber} & " Data'!J:J"), TRUE)`;
                            const pFormula = `=IFERROR(ROUND(AVERAGEIFS(INDIRECT("'" & A${rowNumber} & " Data'!C:C"), INDIRECT("'" & A${rowNumber} & " Data'!B:B"), E${rowNumber}, ARRAYFORMULA(DATEVALUE(INDIRECT("'" & A${rowNumber} & " Data'!E:E"))), ">=" & N${rowNumber}, ARRAYFORMULA(DATEVALUE(INDIRECT("'" & A${rowNumber} & " Data'!E:E"))), "<=" & S${rowNumber}, INDIRECT("'" & A${rowNumber} & " Data'!J:J"), TRUE)), 0)`;
                            const qFormula = `=IFERROR(ROUND(AVERAGEIFS(INDIRECT("'" & A${rowNumber} & " Data'!L:L"), INDIRECT("'" & A${rowNumber} & " Data'!B:B"), E${rowNumber}, ARRAYFORMULA(DATEVALUE(INDIRECT("'" & A${rowNumber} & " Data'!E:E"))), ">=" & N${rowNumber}, ARRAYFORMULA(DATEVALUE(INDIRECT("'" & A${rowNumber} & " Data'!E:E"))), "<=" & S${rowNumber}, INDIRECT("'" & A${rowNumber} & " Data'!J:J"), TRUE)), 0)`;
                            const rFormula = `=SUMIFS(INDIRECT("'" & A${rowNumber} & " Data'!M:M"), INDIRECT("'" & A${rowNumber} & " Data'!B:B"), E${rowNumber}, ARRAYFORMULA(DATEVALUE(INDIRECT("'" & A${rowNumber} & " Data'!E:E"))), ">=" & N${rowNumber}, ARRAYFORMULA(DATEVALUE(INDIRECT("'" & A${rowNumber} & " Data'!E:E"))), "<=" & S${rowNumber}, INDIRECT("'" & A${rowNumber} & " Data'!J:J"), TRUE)`;
                            const sDate = `=S${prev}`;
                            const tFormula = `=COUNTIFS(INDIRECT("'" & A${rowNumber} & " Data'!B:B"), E${rowNumber}, ARRAYFORMULA(DATEVALUE(INDIRECT("'" & A${rowNumber} & " Data'!E:E"))), ">=" & S${rowNumber}, ARRAYFORMULA(DATEVALUE(INDIRECT("'" & A${rowNumber} & " Data'!E:E"))), "<=" & S${rowNumber} + 6, INDIRECT("'" & A${rowNumber} & " Data'!J:J"), TRUE)`;
                            const uFormula = `=IFERROR(ROUND(AVERAGEIFS(INDIRECT("'" & A${rowNumber} & " Data'!C:C"), INDIRECT("'" & A${rowNumber} & " Data'!B:B"), E${rowNumber}, ARRAYFORMULA(DATEVALUE(INDIRECT("'" & A${rowNumber} & " Data'!E:E"))), ">=" & S${rowNumber}, ARRAYFORMULA(DATEVALUE(INDIRECT("'" & A${rowNumber} & " Data'!E:E"))), "<=" & S${rowNumber} + 6, INDIRECT("'" & A${rowNumber} & " Data'!J:J"), TRUE)), 0)`;
                            const vFormula = `=IFERROR(ROUND(AVERAGEIFS(INDIRECT("'" & A${rowNumber} & " Data'!L:L"), INDIRECT("'" & A${rowNumber} & " Data'!B:B"), E${rowNumber}, ARRAYFORMULA(DATEVALUE(INDIRECT("'" & A${rowNumber} & " Data'!E:E"))), ">=" & S${rowNumber}, ARRAYFORMULA(DATEVALUE(INDIRECT("'" & A${rowNumber} & " Data'!E:E"))), "<=" & S${rowNumber} + 6, INDIRECT("'" & A${rowNumber} & " Data'!J:J"), TRUE)), 0)`;
                            const wFormula = `=SUMIFS(INDIRECT("'" & A${rowNumber} & " Data'!M:M"), INDIRECT("'" & A${rowNumber} & " Data'!B:B"), E${rowNumber}, ARRAYFORMULA(DATEVALUE(INDIRECT("'" & A${rowNumber} & " Data'!E:E"))), ">=" & S${rowNumber}, ARRAYFORMULA(DATEVALUE(INDIRECT("'" & A${rowNumber} & " Data'!E:E"))), "<=" & S${rowNumber} + 6, INDIRECT("'" & A${rowNumber} & " Data'!J:J"), TRUE)`;
                            const xFormula = `=M${rowNumber}`;
                            const yFormula = `=R${rowNumber}`;
                            const zFormula = `=W${rowNumber}`;
                            const aaFormula = `=AND(X${rowNumber}>=8, Y${rowNumber}>=8, Z${rowNumber}>=8)`;

                            try {
                                await sheets.spreadsheets.values.update({
                                    spreadsheetId: '1ZFLMKI7kytkUXU0lDKXDGSuNFn4OqZYnpyLIe6urVLI',
                                    range: `'CC Applications'!E${rowNumber}:AA${rowNumber}`,
                                    valueInputOption: 'USER_ENTERED',
                                    resource: {
                                        values: [[
                                            eVal, fVal, gVal, hFormula, iDate, jFormula, kFormula, lFormula, mFormula,
                                            nDate, oFormula, pFormula, qFormula, rFormula, sDate, tFormula, uFormula,
                                            vFormula, wFormula, xFormula, yFormula, zFormula, aaFormula
                                        ]]
                                    }
                                });
                            } catch (updateError) {
                                console.error('Failed to populate CC Applications formulas:', updateError);
                            }
                            const nowFormatted = formatDate(new Date());
                            let latestTimestamp = null;
                            for (const video of accountVideos) {
                                const dateStr = video?.date;
                                if (dateStr) {
                                    const parsed = Date.parse(dateStr);
                                    if (!Number.isNaN(parsed) && (latestTimestamp === null || parsed > latestTimestamp)) {
                                        latestTimestamp = parsed;
                                    }
                                }
                            }
                            const latestFormatted = latestTimestamp !== null ? formatDate(new Date(latestTimestamp)) : '';
                            try {
                                await sheets.spreadsheets.values.update({
                                    spreadsheetId: '1ZFLMKI7kytkUXU0lDKXDGSuNFn4OqZYnpyLIe6urVLI',
                                    range: `'CC Applications'!AB${rowNumber}:AC${rowNumber}`,
                                    valueInputOption: 'USER_ENTERED',
                                    resource: { values: [[nowFormatted, latestFormatted]] }
                                });
                            } catch (dateUpdateError) {
                                console.error('Failed to update CC application date columns:', dateUpdateError);
                            }
                        }
                    }
                    const videoRows = accountVideos.map(item => {
                        const likeCount = item.likeCount != null ? item.likeCount : '';
                        let duration = '';
                        if (item.lengthSeconds != null) {
                            duration = item.lengthSeconds;
                        } else if (item.durationSeconds != null) {
                            duration = item.durationSeconds;
                        } else if (item.duration != null && !Number.isNaN(Number(item.duration))) {
                            duration = Number(item.duration);
                        }
                        return [
                            item.channelUsername || '',
                            item.aboutChannelInfo?.channelId || item.channelId || '',
                            item.likes != null ? item.likes : likeCount,
                            item.url || '',
                            formatDate(item.date),
                            item.aboutChannelInfo?.numberOfSubscribers != null ? item.aboutChannelInfo.numberOfSubscribers : '',
                            (item.title || '').replace(/\r?\n|\r/g, ' '),
                            duration !== '' ? duration : durationToSeconds(item.duration),
                            item.viewCount != null ? item.viewCount : ''
                        ];
                    });
                    if (videoRows.length) {
                        let existingUrlSet = new Set();
                        try {
                            const existingResponse = await sheets.spreadsheets.values.get({
                                spreadsheetId: '1ZFLMKI7kytkUXU0lDKXDGSuNFn4OqZYnpyLIe6urVLI',
                                range: '\'YouTube Data\'!D:D'
                            });
                            const existingValues = existingResponse.data?.values || [];
                            existingUrlSet = new Set(existingValues.map(row => (row[0] || '').trim().toLowerCase()));
                        } catch (existingError) {
                            console.error('Failed to fetch existing YouTube data URLs:', existingError);
                        }
                        const uniqueRows = [];
                        for (const row of videoRows) {
                            const url = (row[3] || '').trim().toLowerCase();
                            if (!url || existingUrlSet.has(url)) {
                                continue;
                            }
                            existingUrlSet.add(url);
                            uniqueRows.push(row);
                        }
                        if (uniqueRows.length) {
                            try {
                                const appendResp = await sheets.spreadsheets.values.append({
                                    spreadsheetId: '1ZFLMKI7kytkUXU0lDKXDGSuNFn4OqZYnpyLIe6urVLI',
                                    range: '\'YouTube Data\'!A:I',
                                    valueInputOption: 'RAW',
                                    insertDataOption: 'INSERT_ROWS',
                                    includeValuesInResponse: true,
                                    resource: {values: uniqueRows}
                                });
                                const videoRange = appendResp.data?.updates?.updatedRange;
                                const startRow = extractRowNumber(videoRange);
                                if (startRow) {
                                    const formulas = uniqueRows.map((_, idx) => {
                                        const r = startRow + idx;
                                        const j = `=ISNUMBER(SEARCH("*gymclassvr*", G${r}))`;
                                        const k = `=ISNUMBER(SEARCH("gcwowmoment", G${r}))`;
                                        const l = `=IFERROR(VLOOKUP(D${r}, IMPORTRANGE("https://docs.google.com/spreadsheets/d/1Ze84DPzXsdaGAsg_t5MJMbmvGJlF1Q03R-uJ-OdpfU0/edit#gid=2025075070", "Season 16 Posts!G:M"), 7, FALSE), "Not Found")`;
                                        const m = `=IF(AND(OR($J${r}=TRUE,$J${r}="TRUE"), $C${r}>=15), 4, 0) + IF(AND(NOT(OR($K${r}=TRUE,$K${r}="TRUE")), OR($J${r}=TRUE,$J${r}="TRUE"), $C${r}>=15, OR($L${r}=3,$L${r}=4,$L${r}=5)), $L${r}, 0) + IF(AND(OR($J${r}=TRUE,$J${r}="TRUE"), OR($K${r}=TRUE,$K${r}="TRUE")), 5, 0)`;
                                        const n = `=AND(J${r}=TRUE)`;
                                        const o = `=ISNUMBER(SEARCH("short", D${r}))`;
                                        const p = `=ISOWEEKNUM(E${r})`;
                                        return [j, k, l, m, n, o, p];
                                    });
                                    const endRow = startRow + uniqueRows.length - 1;
                                    await sheets.spreadsheets.values.update({
                                        spreadsheetId: '1ZFLMKI7kytkUXU0lDKXDGSuNFn4OqZYnpyLIe6urVLI',
                                        range: `YouTube Data!J${startRow}:P${endRow}`,
                                        valueInputOption: 'USER_ENTERED',
                                        resource: { values: formulas }
                                    });
                                }
                            } catch (videoError) {
                                console.error('Failed to append YouTube video data or formulas:', videoError);
                            }
                        }
                    }
                    await notifyUser(
                        [
                            `✅ We verified your YouTube channel: ${youtubeUrl}`,
                            '',
                            'Stay on top of your progress:',
                            '• `/check-youtube-account` shows your current requirement status',
                            '• `/quality-score` lists the posts we are tracking this season',
                            '',
                            'Thanks for applying! Keep posting so we can keep your data fresh.'
                        ].join('\n')
                    );
                    return;
                }
                await notifyUser(`We could not find your YouTube channel using ${youtubeUrl}. Please double-check the link and submit a new application.`);
            }).catch(async (error) => {
                if (isApifyLimitError(error)) {
                    await handleApifyLimitExceeded();
                    return;
                }
                console.error('Apify YouTube fetch failed during run:', error.response?.data || error.message || error);
                await notifyUser(`We had trouble verifying ${youtubeUrl}. Please try again later or contact a staff member.`);
            });
        } else {
            if (!apifyLimitHandled) {
                await notifyUser(`We could not start the verification for ${youtubeUrl}. Please try again later or contact a staff member.`);
            }
        }
    }
};
