const {SlashCommandBuilder} = require('@discordjs/builders');
const {EmbedBuilder} = require('discord.js');
const {google} = require('googleapis');
const credentials = require('../../resources/secret.json');
const {fetchCreatorData} = require('../../API/apifyClient');

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

        const sheets = google.sheets({version: 'v4', auth: authorize()});
        try {
            const existingResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: '15P8BKPbO2DQX6yRXmc9gzuL3iLxfu4ef83Jb8Bi8AJk',
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
            console.error('Apify TikTok fetch failed to start:', error.response?.data || error.message || error);
        }

        const pad = (n) => String(n).padStart(2, '0');
        const now = new Date();
        const yy = String(now.getUTCFullYear()).slice(-2);
        const timestamp = `${pad(now.getUTCMonth() + 1)}/${pad(now.getUTCDate())}/${yy}`;
        const values = [
            ['Tiktok', cleanUsername, interaction.user.id, timestamp]
        ];
        let appendedRange;

        try {
            const appendResponse = await sheets.spreadsheets.values.append({
                spreadsheetId: '15P8BKPbO2DQX6yRXmc9gzuL3iLxfu4ef83Jb8Bi8AJk',
                range: '\'CC Applications\'!A:D',
                valueInputOption: 'RAW',
                resource: {values},
                insertDataOption: 'INSERT_ROWS',
                includeValuesInResponse: true
            });
            appendedRange = appendResponse.data?.updates?.updatedRange;
        } catch (error) {
            console.error('Error logging to Google Sheets:', error);
            return interaction.editReply({content: 'Error logging your application. Please try again later.'});
        }

        const logChannel = interaction.client.channels.cache.get('1084168091778424972');
        if (logChannel) {
            const logEmbed = new EmbedBuilder()
                .setTitle('New TikTok CC Application')
                .setDescription(`User: ${interaction.user.username} (${interaction.user.id})\nTikTok: ${tiktokUrl}`)
                .setColor('#008000');
            logChannel.send({embeds: [logEmbed]});
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

        if (apifyPromise) {
            apifyPromise.then(async (data) => {
                const status = data?.status;
                const items = Array.isArray(data?.items) ? data.items : [];
                const matchedItem = items.find(item => item?.authorMeta?.profileUrl === tiktokUrl);
                if (status === 'SUCCEEDED' && matchedItem) {
                    const accountVideos = items.filter(item => item?.authorMeta?.profileUrl === tiktokUrl);
                    if (appendedRange) {
                        const rowNumber = extractRowNumber(appendedRange);
                        if (rowNumber) {
                            try {
                                await sheets.spreadsheets.values.update({
                                    spreadsheetId: '15P8BKPbO2DQX6yRXmc9gzuL3iLxfu4ef83Jb8Bi8AJk',
                                    range: `'CC Applications'!E${rowNumber}:G${rowNumber}`,
                                    valueInputOption: 'RAW',
                                    resource: {
                                        values: [[
                                            matchedItem.authorMeta?.id || '',
                                            matchedItem.authorMeta?.profileUrl || '',
                                            matchedItem.authorMeta?.fans != null ? matchedItem.authorMeta.fans : ''
                                        ]]
                                    }
                                });
                            } catch (updateError) {
                                console.error('Failed to update CC application Apify data:', updateError);
                            }
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
                                    spreadsheetId: '15P8BKPbO2DQX6yRXmc9gzuL3iLxfu4ef83Jb8Bi8AJk',
                                    range: `'CC Applications'!AB${rowNumber}:AC${rowNumber}`,
                                    valueInputOption: 'RAW',
                                    resource: {
                                        values: [[nowFormatted, latestFormatted]]
                                    }
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
                                spreadsheetId: '15P8BKPbO2DQX6yRXmc9gzuL3iLxfu4ef83Jb8Bi8AJk',
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
                                await sheets.spreadsheets.values.append({
                                    spreadsheetId: '15P8BKPbO2DQX6yRXmc9gzuL3iLxfu4ef83Jb8Bi8AJk',
                                    range: '\'TikTok Data\'!A:I',
                                    valueInputOption: 'RAW',
                                    insertDataOption: 'INSERT_ROWS',
                                    resource: {values: uniqueRows}
                                });
                            } catch (videoError) {
                                console.error('Failed to append TikTok video data:', videoError);
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
                console.error('Apify TikTok fetch failed during run:', error.response?.data || error.message || error);
                await notifyUser(`We had trouble verifying ${tiktokUrl}. Please try again later or contact a staff member.`);
            });
        } else {
            await notifyUser(`We could not start the verification for ${tiktokUrl}. Please try again later or contact a staff member.`);
        }
    }
};
