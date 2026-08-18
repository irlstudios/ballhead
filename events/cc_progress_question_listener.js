const { MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');
const { getSheetsClient, getCachedValues } = require('../utils/sheets_cache');
const logger = require('../utils/logger');
const { SPREADSHEET_CONTENT_CREATORS } = require('../config/constants');
const { PLATFORMS, getPlatformData, formatPlatformEmbed } = require('../commands/content_creator/cc_check_account');

const sheetId = SPREADSHEET_CONTENT_CREATORS;
const SHEET_CACHE_TTL_MS = 1800000; // 30 minutes (data updates weekly)

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
    /why[\s'’.,!?]*didn['’]?t[\s'’.,!?]*i[\s'’.,!?]*(?:get|receive)[\s'’.,!?]*(?:cc|content[\s'’.,!?]*creator)/i,
    /how[\s'’.,!?]*do[\s'’.,!?]*i[\s'’.,!?]*(?:get|unlock)[\s'’.,!?]*(?:cc|content[\s'’.,!?]*creator)/i,
    /when[\s'’.,!?]*(?:can|will|do)[\s'’.,!?]*i[\s'’.,!?]*get[\s'’.,!?]*(?:cc|content[\s'’.,!?]*creator)/i,
    /do[\s'’.,!?]*i[\s'’.,!?]*(?:qualify|meet)[\s'’.,!?]*for[\s'’.,!?]*(?:cc|content[\s'’.,!?]*creator)/i,
    /content[\s'’.,!?]*creator[\s'’.,!?]*(?:requirements|progress|status)/i,
    /cc[\s'’.,!?]*progress/i
];

module.exports = {
    name: 'messageCreate',
    once: false,
    async execute(message) {
        if (message.author.bot) return;
        if (message.channel.isDMBased()) return;

        const rawContent = message.content;
        const normalizedContent = rawContent.toLowerCase();
        const sanitizedContent = normalizedContent
            .replace(/['’]/g, '')
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

        const eventStartTime = Date.now();
        try {
            logger.info(`[CC Question Listener] Triggered by message from ${message.author.tag}`);

            const sheetsStartTime = Date.now();
            const sheets = await getSheetsClient();
            logger.info(`[CC Question Listener] Sheets client ready in ${Date.now() - sheetsStartTime}ms`);

            const rangesToFetch = Array.from(new Set(
                Object.values(PLATFORMS).flatMap(config => ([
                    config.appRange,
                    config.dataRange,
                    config.creatorsRange
                ]))
            ));

            const cacheStartTime = Date.now();
            const valuesByRange = await getCachedValues({
                sheets,
                spreadsheetId: sheetId,
                ranges: rangesToFetch,
                ttlMs: SHEET_CACHE_TTL_MS
            });
            logger.info(`[CC Question Listener] Data fetched in ${Date.now() - cacheStartTime}ms`);

            const processingStartTime = Date.now();
            const userId = message.author.id;
            const platformResults = {};

            for (const key of Object.keys(PLATFORMS)) {
                const data = getPlatformData(key, userId, valuesByRange);
                if (data) {
                    platformResults[key] = data;
                }
            }

            if (Object.keys(platformResults).length === 0) {
                const noAppsContainer = new ContainerBuilder();
                noAppsContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent('## Content Creator Applications'));
                noAppsContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent([
                    `Hey <@${userId}>! You haven't applied for any CC programs yet.`,
                    'Use `/cc apply-instagram` to get started.',
                    'TikTok and YouTube applications happen in the GC mobile app. Use `/cc check-progress` for updates.'
                ].join('\n')));
                await message.reply({ flags: MessageFlags.IsComponentsV2, components: [noAppsContainer] });
                return;
            }

            const container = new ContainerBuilder();
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent('## Content Creator Progress'));
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`Hey <@${userId}>! Here's your current CC status:`));
            container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

            for (const [platform, data] of Object.entries(platformResults)) {
                const field = formatPlatformEmbed(platform, data);
                container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${field.name}**\n${field.value}`));
                container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
            }

            container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
                '**Tips**',
                'Use `/cc check-progress` anytime to check your progress.',
                'Make sure your posts use the required hashtags and meet quality standards.'
            ].join('\n')));
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent('-# Data updates every Monday'));

            await message.reply({ flags: MessageFlags.IsComponentsV2, components: [container] });

            const totalTime = Date.now() - eventStartTime;
            const processingTime = Date.now() - processingStartTime;
            logger.info(`[CC Question Listener] Processing completed in ${processingTime}ms | Total: ${totalTime}ms`);
        } catch (error) {
            logger.error('Error in CC progress question listener:', error);
            const errorContainer = new ContainerBuilder();
            errorContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent('## Content Creator Check Failed'));
            errorContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent('Sorry, I encountered an error while checking your CC progress. Please try using `/cc check-progress` instead.'));
            await message.reply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer] })
                .catch(err => logger.error('Failed to send error message:', err));
        }
    }
};
