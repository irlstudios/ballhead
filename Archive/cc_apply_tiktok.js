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
        date = new Date(numeric * 1000);
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
        .setName('tiktok-cc-apply')
        .setDescription('Apply for the TikTok Content Creator role')
        .addStringOption(option =>
            option.setName('handle')
                .setDescription('Your TikTok username or link')
                .setRequired(true)),
    async execute(interaction) {
        const handle = interaction.options.getString('handle');
        const userRoles = interaction.member.roles.cache;
        const prospect_role = '1003902288940765234';

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

        const tiktokRegex = /^(?:https?:\/\/(?:www\.)?tiktok\.com\/(@?[\w.-]+)\/?)|(@?[\w.-]+)$/;
        const match = handle.match(tiktokRegex);
        if (!match) {
            const embed = new EmbedBuilder()
                .setTitle('Invalid Format')
                .setDescription('Invalid TikTok username or link format. Accepted formats are:\n`exampleusername`\n`@exampleusername`\n`tiktok.com/exampleusername`\n`https://www.tiktok.com/exampleusername`')
                .setColor('#FF0000');
            return interaction.reply({embeds: [embed], ephemeral: true});
        }

        let tiktokUsername = match[1] || match[2];
        if (!tiktokUsername.startsWith('@')) {
            tiktokUsername = `@${tiktokUsername}`;
        }
        const tiktokUrl = `https://www.tiktok.com/${tiktokUsername}`;
        await interaction.deferReply({ephemeral: true});
        const cleanUsername = tiktokUsername.replace(/^@+/, '');

        const sheets = await getSheetsClient();
        try {
            const existingResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: '1ZFLMKI7kytkUXU0lDKXDGSuNFn4OqZYnpyLIe6urVLI',
                range: '\'CC Applications\'!A:C'
            });
            const existingRows = existingResponse.data?.values || [];
            const dataRows = existingRows.length > 1 ? existingRows.slice(1) : [];
            const duplicate = dataRows.some(row => {
                if (!row || row.length < 3) {
                    return false;
                }
                const [platform, username, userId] = row;
                if (!platform || !userId) {
                    return false;
                }
                if (platform.trim().toLowerCase() !== 'tiktok') {
                    return false;
                }
                if (userId.trim() !== interaction.user.id) {
                    return false;
                }
                const normalizedUsername = username ? username.trim().toLowerCase() : '';
                return !normalizedUsername || normalizedUsername === cleanUsername.toLowerCase();
            });
            if (duplicate) {
                await interaction.editReply({
                    content: 'We already have your TikTok application on file. No need to reapply just keep posting quality content and use `/check-tiktok-account` plus `/quality-score` to track your progress we will do the rest.',
                    ephemeral: true
                });
                return;
            }
        } catch (lookupError) {
            console.error('Failed to check for existing TikTok application:', lookupError);
            await interaction.editReply({
                content: 'We had trouble verifying whether you already applied. Please try again later or contact staff if the issue persists.',
                ephemeral: true
            });
            return;
        }

        let apifyPromise;
        let apifyLimitHit = false;
        let apifyLimitHandled = false;
        try {
            const apifyInput = {
                apifyProxyCountry: 'US',
                apifyProxyGroups: ['RESIDENTIAL'],
                excludePinnedPosts: false,
                fingerprintDevice: 'mobile',
                includeAuthorStats: true,
                includeVideoStats: true,
                maxProfilesPerQuery: 10,
                maxRequestRetries: 4,
                persistCookiesPerSession: true,
                profileSorting: 'latest',
                proxyCountryCode: 'US',
                resultsPerPage: 100,
                scrapeRelatedVideos: false,
                shouldDownloadAvatars: false,
                shouldDownloadCovers: false,
                shouldDownloadMusicCovers: false,
                shouldDownloadSlideshowImages: false,
                shouldDownloadSubtitles: false,
                shouldDownloadVideos: false,
                useApifyProxy: true,
                useStealth: true,
                profiles: [tiktokUrl],
                profileScrapeSections: ['videos'],
                searchSection: ''
            };
            apifyPromise = fetchCreatorData('tiktok', {
                handle: cleanUsername,
                url: tiktokUrl,
                userId: interaction.user.id,
                input: apifyInput
            });
        } catch (error) {
            if (isApifyLimitError(error)) {
                apifyLimitHit = true;
                console.error('Apify TikTok fetch skipped due to monthly limit:', error.response?.data || error.message || error);
            } else {
                console.error('Apify TikTok fetch failed to start:', error.response?.data || error.message || error);
            }
        }

        await interaction.editReply({content: 'Your application is being processed. We will follow up in your DMs once verification finishes.'});
        await interaction.member.roles.add(prospect_role);

        const notifyUser = async (message) => {
            try {
                await interaction.user.send({content: message});
            } catch (dmError) {
                console.error('Failed to send TikTok application DM:', dmError);
            }
        };

        const handleApifyLimitExceeded = async () => {
            if (apifyLimitHandled) {
                return;
            }
            apifyLimitHandled = true;
            await logPendingApplication({
                sheets,
                platformLabel: 'TikTok',
                username: cleanUsername,
                interaction,
                profileUrl: tiktokUrl,
                logChannelId: '1084168091778424972'
            });
            await notifyUser(
                [
                    '⏳ We added your TikTok application to the queue.',
                    'We will review and fetch your data this Sunday.',
                    `Link on file: ${tiktokUrl}`,
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
                const matchedItem = items.find(item => item?.authorMeta?.profileUrl === tiktokUrl);
                if (status === 'SUCCEEDED' && matchedItem) {
                    const accountVideos = items.filter(item => item?.authorMeta?.profileUrl === tiktokUrl);
                    // Append to sheet only after successful verification
                    const nowStamp = formatDate(new Date());
                    const baseValues = [[
                        'TikTok', // Platform
                        cleanUsername, // Username
                        interaction.user.id, // Discord ID
                        nowStamp // Submission date (MM/DD/YYYY)
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

                    const logChannel = interaction.client.channels.cache.get('1084168091778424972');
                    if (logChannel) {
                        const logEmbed = new EmbedBuilder()
                            .setTitle('New TikTok CC Application')
                            .setDescription(`User: ${interaction.user.username} (${interaction.user.id})\nTikTok: ${tiktokUrl}`)
                            .setColor('#008000');
                        logChannel.send({embeds: [logEmbed]});
                    }

                    // Fill remaining columns with values and formulas
                    if (appendedRange) {
                        const rowNumber = extractRowNumber(appendedRange);
                        if (rowNumber) {
                            const prev = rowNumber - 1;
                            const eVal = matchedItem.authorMeta?.id || '';
                            const fVal = matchedItem.authorMeta?.profileUrl || '';
                            const gVal = matchedItem.authorMeta?.fans != null ? matchedItem.authorMeta.fans : '';

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

                            // AB: Last checked, AC: Latest post date
                            const nowFormatted = formatDate(new Date());
                            let latestTimestamp = null;
                            for (const video of accountVideos) {
                                const iso = video?.createTimeISO;
                                const raw = video?.createTime;
                                let candidate = null;
                                if (iso) {
                                    const parsedIso = Date.parse(iso);
                                    if (!Number.isNaN(parsedIso)) {
                                        candidate = parsedIso;
                                    }
                                }
                                if (candidate === null && (raw || raw === 0)) {
                                    const numericRaw = Number(raw);
                                    if (!Number.isNaN(numericRaw)) {
                                        candidate = numericRaw >= 1e12 ? numericRaw : numericRaw * 1000;
                                    }
                                }
                                if (candidate !== null && (latestTimestamp === null || candidate > latestTimestamp)) {
                                    latestTimestamp = candidate;
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
                    const videoRows = accountVideos
                        .map(item => [
                            item.authorMeta?.name || '',
                            item.authorMeta?.id || '',
                            item.diggCount != null ? item.diggCount : '',
                            item.webVideoUrl || '',
                            formatDate(item.createTimeISO || item.createTime),
                            item.authorMeta?.fans != null ? item.authorMeta.fans : '',
                            (item.text || '').replace(/\r?\n|\r/g, ' '),
                            item.videoMeta?.duration != null ? item.videoMeta.duration : '',
                            item.playCount != null ? item.playCount : ''
                        ]);
                    if (videoRows.length) {
                        let existingUrlSet = new Set();
                        try {
                            const existingResponse = await sheets.spreadsheets.values.get({
                                spreadsheetId: '1ZFLMKI7kytkUXU0lDKXDGSuNFn4OqZYnpyLIe6urVLI',
                                range: '\'TikTok Data\'!D:D'
                            });
                            const existingValues = existingResponse.data?.values || [];
                            existingUrlSet = new Set(existingValues.map(row => (row[0] || '').trim().toLowerCase()));
                        } catch (existingError) {
                            console.error('Failed to fetch existing TikTok data URLs:', existingError);
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
                                    range: '\'TikTok Data\'!A:I',
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
                                        const j = `=ISNUMBER(SEARCH("gymclassvr", G${r}))`;
                                        const k = `=ISNUMBER(SEARCH("gcwowmoment", G${r}))`;
                                        const l = `=IFERROR(VLOOKUP(D${r}, IMPORTRANGE("https://docs.google.com/spreadsheets/d/1Ze84DPzXsdaGAsg_t5MJMbmvGJlF1Q03R-uJ-OdpfU0/edit#gid=2025075070", "Season 16 Posts!G:M"), 7, FALSE), "Not Found")`;
                                        const m = `=IF(AND(OR($J${r}=TRUE,$J${r}="TRUE"), $C${r}>=15), 4, 0) + IF(AND(NOT(OR($K${r}=TRUE,$K${r}="TRUE")), OR($J${r}=TRUE,$J${r}="TRUE"), $C${r}>=15, OR($L${r}=3,$L${r}=4,$L${r}=5)), $L${r}, 0) + IF(AND(OR($J${r}=TRUE,$J${r}="TRUE"), OR($K${r}=TRUE,$K${r}="TRUE")), 5, 0)`;
                                        const n = `=AND(J${r}=TRUE)`;
                                        const o = `=ISOWEEKNUM(E${r})`;
                                        return [j, k, l, m, n, o];
                                    });
                                    const endRow = startRow + uniqueRows.length - 1;
                                    await sheets.spreadsheets.values.update({
                                        spreadsheetId: '1ZFLMKI7kytkUXU0lDKXDGSuNFn4OqZYnpyLIe6urVLI',
                                        range: `TikTok Data!J${startRow}:O${endRow}`,
                                        valueInputOption: 'USER_ENTERED',
                                        resource: { values: formulas }
                                    });
                                }
                            } catch (videoError) {
                                console.error('Failed to append TikTok video data or formulas:', videoError);
                            }
                        }
                    }
                    await notifyUser(
                        [
                            `✅ We verified your TikTok: ${tiktokUrl}`,
                            '',
                            'Stay on top of your progress:',
                            '• `/check-tiktok-account` shows your current requirement status',
                            '• `/quality-score` lists the posts we are tracking this season',
                            '',
                            'Thanks for applying! Keep posting so we can keep your data fresh.'
                        ].join('\n')
                    );
                    return;
                }
                await notifyUser(`We could not find your TikTok account using ${tiktokUrl}. Please double-check the link and submit a new application.`);
            }).catch(async (error) => {
                if (isApifyLimitError(error)) {
                    await handleApifyLimitExceeded();
                    return;
                }
                console.error('Apify TikTok fetch failed during run:', error.response?.data || error.message || error);
                await notifyUser(`We had trouble verifying ${tiktokUrl}. Please try again later or contact a staff member.`);
            });
        } else {
            if (!apifyLimitHandled) {
                await notifyUser(`We could not start the verification for ${tiktokUrl}. Please try again later or contact a staff member.`);
            }
        }
    }
};
