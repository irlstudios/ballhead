const {SlashCommandBuilder} = require('@discordjs/builders');
const {MessageFlags, ContainerBuilder, TextDisplayBuilder} = require('discord.js');
const {fetchCreatorData} = require('../../API/apifyClient');
const { getSheetsClient } = require('../../utils/sheets_cache');

function buildTextBlock({ title, subtitle, lines } = {}) {
    const parts = [];
    if (title) {
        parts.push(`## ${title}`);
    }
    if (subtitle) {
        parts.push(subtitle);
    }
    if (Array.isArray(lines) && lines.length > 0) {
        if (parts.length > 0) {
            parts.push('');
        }
        parts.push(...lines.filter(Boolean));
    }
    if (parts.length === 0) {
        return null;
    }
    return new TextDisplayBuilder().setContent(parts.join('\n'));
}

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

function extractDurationSeconds(item) {
    if (!item) {
        return '';
    }
    if (item.duration != null) {
        const result = durationToSeconds(item.duration);
        if (result !== '') {
            return result;
        }
    }
    if (item.video_duration_sec != null && !Number.isNaN(Number(item.video_duration_sec))) {
        return Number(item.video_duration_sec);
    }
    if (item.video_duration != null && !Number.isNaN(Number(item.video_duration))) {
        return Number(item.video_duration);
    }
    if (item.video_duration_ms != null && !Number.isNaN(Number(item.video_duration_ms))) {
        return Number(item.video_duration_ms) / 1000;
    }
    if (item.video?.duration != null && !Number.isNaN(Number(item.video.duration))) {
        return Number(item.video.duration);
    }
    return '';
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

function buildNoticeContainer({ title, subtitle, lines } = {}) {
    const container = new ContainerBuilder();
    const block = buildTextBlock({ title, subtitle, lines });
            if (block) container.addTextDisplayComponents(block);
    return container;
}

function isReelsPlatform(value) {
    if (!value) {
        return false;
    }
    const normalized = value.toString().trim().toLowerCase();
    return normalized === 'reels' || normalized === 'instagram' || normalized === 'ig';
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
            const logContainer = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `## ${platformLabel} CC Application (Queued)\n**User:** ${interaction.user.username} (${interaction.user.id})\n**${platformLabel}:** ${profileUrl}\n**Status:** Pending - Apify monthly limit reached`
                ));
            logChannel.send({ flags: MessageFlags.IsComponentsV2, components: [logContainer] });
        }
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('instagram-cc-apply')
        .setDescription('Apply for the Instagram Content Creator role')
        .addStringOption(option =>
            option.setName('handle')
                .setDescription('Your Instagram username or link')
                .setRequired(true)),
    async execute(interaction) {
        const usernameOrLink = interaction.options.getString('handle');
        const userRoles = interaction.member.roles.cache;
        const prospect_role = '1270464270722928700';

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
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent('## Access Denied\nYou do not have the required role to apply.'));
            return interaction.reply({ flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true });
        }

        const instagramRegex = /^(?:https?:\/\/(?:www\.)?instagram\.com\/([\w.-]+)\/?|([\w.-]+))$/;
        const match = usernameOrLink.match(instagramRegex);
        if (!match) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    '## Invalid Instagram Format\nAccepted formats:\n`yourusername`\n`https://instagram.com/yourusername/`\n`https://www.instagram.com/yourusername/`'
                ));
            return interaction.reply({ flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true });
        }

        let instagramUsername = match[1] || match[2];
        const instagramUrl = `https://www.instagram.com/${instagramUsername}/`;

        // check to make sure user is not applying with official gymclass account
        if (instagramUsername === "gymclassvr") {
            return interaction.reply({ content: 'You may not apply using an official gymclass social account.', ephemeral: true });
        }

        await interaction.deferReply({ephemeral: true});
        const cleanUsername = instagramUsername.replace(/^@+/, '');
        const cleanUsernameLower = cleanUsername.toLowerCase();

        let apifyPromise;
        let apifyLimitHit = false;
        let apifyLimitHandled = false;
        try {
            const apifyInput = {
                data_type: 'all',
                download_format: 'json',
                hashtag_filter: 'gymclassvr',
                usernames: [cleanUsername]
            };
            apifyPromise = fetchCreatorData('reels', {
                handle: cleanUsername,
                url: instagramUrl,
                userId: interaction.user.id,
                input: apifyInput
            });
        } catch (error) {
            if (isApifyLimitError(error)) {
                apifyLimitHit = true;
                console.error('Apify Instagram fetch skipped due to monthly limit:', error.response?.data || error.message || error);
            } else {
                console.error('Apify Instagram fetch failed to start:', error.response?.data || error.message || error);
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
                if (platform.trim().toLowerCase() !== 'reels') {
                    return false;
                }
                if (userId.trim() !== interaction.user.id) {
                    return false;
                }
                const normalizedUsername = username ? username.trim().toLowerCase() : '';
                return !normalizedUsername || normalizedUsername === cleanUsernameLower;
            });
            if (duplicate) {
                const noticeContainer = buildNoticeContainer({
                    title: 'Application Already Submitted',
                    lines: [
                        'We already have your Instagram application on file.',
                        'No need to reapply. Keep posting quality content and use `/check-reels-account` plus `/quality-score` to track your progress.'
                    ]
                });
                await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [noticeContainer], ephemeral: true });
                return;
            }

            const creatorsResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: '1ZFLMKI7kytkUXU0lDKXDGSuNFn4OqZYnpyLIe6urVLI',
                range: '\'Creators\'!A:D'
            });
            const creatorRows = creatorsResponse.data?.values || [];
            const creatorsOnly = creatorRows.length > 1 ? creatorRows.slice(1) : [];
            const alreadyCreator = creatorsOnly.some(row => {
                if (!row || row.length < 4) {
                    return false;
                }
                const [platform, , , discordId] = row;
                if (!isReelsPlatform(platform) || !discordId) {
                    return false;
                }
                return discordId.toString().trim() === interaction.user.id;
            });
            if (alreadyCreator) {
                const alreadyCreatorContainer = buildNoticeContainer({
                    title: 'Already In Creators',
                    lines: [
                        'Your Discord ID is already listed in the `Creators` tab for Reels.',
                        'You cannot apply for Reels again.'
                    ]
                });
                await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [alreadyCreatorContainer], ephemeral: true });
                return;
            }
        } catch (lookupError) {
            console.error('Failed to check for existing Instagram application:', lookupError);
            const errorContainer = buildNoticeContainer({
                title: 'Verification Failed',
                lines: [
                    'We had trouble verifying whether you already applied.',
                    'Please try again later or contact staff if the issue persists.'
                ]
            });
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer], ephemeral: true });
            return;
        }

        const progressContainer = buildNoticeContainer({
            title: 'Application Processing',
            
            lines: ['Your application is being processed.', 'We will follow up in your DMs once verification finishes.']
        });
        await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [progressContainer] });
        await interaction.member.roles.add(prospect_role);

        const notifyUser = async (message) => {
            try {
                const lines = Array.isArray(message) ? message : String(message || '').split('\n');
                const dmContainer = buildNoticeContainer({
                    title: 'Instagram Application',
                    subtitle: interaction.user.username,
                    lines: lines.filter(Boolean)
                });
                await interaction.user.send({ flags: MessageFlags.IsComponentsV2, components: [dmContainer] });
            } catch (dmError) {
                console.error('Failed to send Instagram application DM:', dmError);
            }
        };

        const handleApifyLimitExceeded = async () => {
            if (apifyLimitHandled) {
                return;
            }
            apifyLimitHandled = true;
            await logPendingApplication({
                sheets,
                platformLabel: 'Reels',
                username: cleanUsername,
                interaction,
                profileUrl: instagramUrl,
                logChannelId: '1128804307261718568'
            });
            await notifyUser(
                [
                    '⏳ We added your Instagram application to the queue.',
                    'We will review and fetch your data this Sunday.',
                    `Link on file: ${instagramUrl}`,
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
                const profile = items.find(item => item?.username?.toLowerCase() === cleanUsernameLower);
                const posts = Array.isArray(profile?.posts) ? profile.posts : [];
                if (status === 'SUCCEEDED' && profile) {
                    const followerCount = profile.followers != null ? profile.followers : '';

                    // Append to sheet only after successful verification
                    const nowStamp = formatDate(new Date());
                    const baseValues = [[
                        'Reels',
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

                    const logChannel = interaction.client.channels.cache.get('1128804307261718568');
                    if (logChannel) {
                        const logContainer = new ContainerBuilder();
                        const block = buildTextBlock({ title: 'New Instagram CC Application',
                            subtitle: cleanUsername, lines: [
                            `**User:** ${interaction.user.username} (${interaction.user.id })`,
                            `**Instagram:** ${instagramUrl}`
                        ] });
            if (block) logContainer.addTextDisplayComponents(block);
                        logChannel.send({ flags: MessageFlags.IsComponentsV2, components: [logContainer] });
                    }

                    // Fill remaining columns with values and formulas
                    if (appendedRange) {
                        const rowNumber = extractRowNumber(appendedRange);
                        if (rowNumber) {
                            const prev = rowNumber - 1;
                            const eVal = profile.id || '';
                            const fVal = instagramUrl;
                            const gVal = followerCount;

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
                            for (const video of posts) {
                                const createdAt = video?.taken_at_date || video?.taken_at_timestamp;
                                if (createdAt) {
                                    const parsed = Date.parse(createdAt);
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
                    const videoRows = posts
                        .filter(item => item?.is_video)
                        .map(item => {
                            const likes = item.like_count != null ? item.like_count : (item.likes != null ? item.likes : '');
                            const views = item.video_view_count != null ? item.video_view_count : (item.viewCount != null ? item.viewCount : '');
                            const durationSeconds = extractDurationSeconds(item);
                            return [
                                profile.username || '',
                                profile.id || '',
                                likes,
                                item.post_url || item.url || '',
                                formatDate(item.taken_at_date || item.taken_at_timestamp),
                                followerCount,
                                (item.caption || '').replace(/\r?\n|\r/g, ' '),
                                durationSeconds,
                                views
                            ];
                        });
                    if (videoRows.length) {
                        let existingUrlSet = new Set();
                        try {
                            const existingResponse = await sheets.spreadsheets.values.get({
                                spreadsheetId: '1ZFLMKI7kytkUXU0lDKXDGSuNFn4OqZYnpyLIe6urVLI',
                                range: '\'Reels Data\'!D:D'
                            });
                            const existingValues = existingResponse.data?.values || [];
                            existingUrlSet = new Set(existingValues.map(row => (row[0] || '').trim().toLowerCase()));
                        } catch (existingError) {
                            console.error('Failed to fetch existing Reels data URLs:', existingError);
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
                                    range: '\'Reels Data\'!A:I',
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
                                        range: `Reels Data!J${startRow}:O${endRow}`,
                                        valueInputOption: 'USER_ENTERED',
                                        resource: { values: formulas }
                                    });
                                }
                            } catch (videoError) {
                                console.error('Failed to append Instagram video data or formulas:', videoError);
                            }
                        }
                    }
                    await notifyUser(
                        [
                            `✅ We verified your Instagram: ${instagramUrl}`,
                            '',
                            'Stay on top of your progress:',
                            '• `/check-reels-account` shows your current requirement status',
                            '• `/quality-score` lists the posts we are tracking this season',
                            '',
                            'Thanks for applying! Keep posting so we can keep your data fresh.'
                        ].join('\n')
                    );
                    return;
                }
                await notifyUser(`We could not find your Instagram account using ${instagramUrl}. Please double-check the link and submit a new application.`);
            }).catch(async (error) => {
                if (isApifyLimitError(error)) {
                    await handleApifyLimitExceeded();
                    return;
                }
                console.error('Apify Instagram fetch failed during run:', error.response?.data || error.message || error);
                await notifyUser(`We had trouble verifying ${instagramUrl}. Please try again later or contact a staff member.`);
            });
        } else {
            if (!apifyLimitHandled) {
                await notifyUser(`We could not start the verification for ${instagramUrl}. Please try again later or contact a staff member.`);
            }
        }
    }
};
