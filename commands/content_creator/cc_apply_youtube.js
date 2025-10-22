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
            console.error('Apify YouTube fetch failed to start:', error.response?.data || error.message || error);
        }

        const sheets = google.sheets({version: 'v4', auth: authorize()});
        try {
            const existingResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: '15P8BKPbO2DQX6yRXmc9gzuL3iLxfu4ef83Jb8Bi8AJk',
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

        const pad = (n) => String(n).padStart(2, '0');
        const now = new Date();
        const yy = String(now.getUTCFullYear()).slice(-2);
        const timestamp = `${pad(now.getUTCMonth() + 1)}/${pad(now.getUTCDate())}/${yy}`;
        const values = [
            ['YouTube', cleanUsername, interaction.user.id, timestamp]
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

        const logChannel = interaction.client.channels.cache.get('1098354875324174477');
        if (logChannel) {
            const logEmbed = new EmbedBuilder()
                .setTitle('New YouTube CC Application')
                .setDescription(`User: ${interaction.user.username} (${interaction.user.id})\nYouTube: ${youtubeUrl}`)
                .setColor('#00ff00');
            logChannel.send({embeds: [logEmbed]});
        }

        await interaction.editReply({content: 'Your application is being processed. We will follow up in your DMs once verification finishes.'});
        await interaction.member.roles.add(prospect_role);

        const notifyUser = async (message) => {
            try {
                await interaction.user.send({content: message});
            } catch (dmError) {
                console.error('Failed to send YouTube application DM:', dmError);
            }
        };

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
                            try {
                                await sheets.spreadsheets.values.update({
                                    spreadsheetId: '15P8BKPbO2DQX6yRXmc9gzuL3iLxfu4ef83Jb8Bi8AJk',
                                    range: `'CC Applications'!E${rowNumber}:G${rowNumber}`,
                                    valueInputOption: 'RAW',
                                    resource: {
                                        values: [[
                                            channelId,
                                            channelUrl,
                                            subscribers
                                        ]]
                                    }
                                });
                            } catch (updateError) {
                                console.error('Failed to update CC application Apify data:', updateError);
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
                                spreadsheetId: '15P8BKPbO2DQX6yRXmc9gzuL3iLxfu4ef83Jb8Bi8AJk',
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
                                await sheets.spreadsheets.values.append({
                                    spreadsheetId: '15P8BKPbO2DQX6yRXmc9gzuL3iLxfu4ef83Jb8Bi8AJk',
                                    range: '\'YouTube Data\'!A:I',
                                    valueInputOption: 'RAW',
                                    insertDataOption: 'INSERT_ROWS',
                                    resource: {values: uniqueRows}
                                });
                            } catch (videoError) {
                                console.error('Failed to append YouTube video data:', videoError);
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
                console.error('Apify YouTube fetch failed during run:', error.response?.data || error.message || error);
                await notifyUser(`We had trouble verifying ${youtubeUrl}. Please try again later or contact a staff member.`);
            });
        } else {
            await notifyUser(`We could not start the verification for ${youtubeUrl}. Please try again later or contact a staff member.`);
        }
    }
};
