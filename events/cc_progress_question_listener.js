const logger = require('../utils/logger');
const { ccRedirectPayload } = require('../utils/cc_redirect');

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
            await message.reply(ccRedirectPayload('Content Creator Is in the GC Mobile App'));
        } catch (error) {
            logger.error('Error in CC progress question listener:', error);
        }
    }
};
