'use strict';

const { MessageFlags } = require('discord.js');
const { noticePayload } = require('./ui');
const { GYM_CLASS_COMMANDS_CHANNEL_ID, CC_SUPPORT_CHANNEL_ID } = require('../config/constants');

// The creator program (Instagram, TikTok, YouTube) runs in the GC mobile app
// and the Gym Class bot now. Ballhead's old CC commands only point people there.
const GC_MOBILE_IOS_URL = 'https://apps.apple.com/us/app/gym-class-vr-companion-app/id6459104919';
const GC_MOBILE_ANDROID_URL = 'https://play.google.com/store/apps/details?id=com.gymclassvr';
const GC_MOBILE_LINKS = `[iPhone](${GC_MOBILE_IOS_URL}) | [Android](${GC_MOBILE_ANDROID_URL})`;
const VERIFY_DISCORD_URL = 'https://play.gymclass.com/verify/discord';

// Gaps go in a trailing \n because buildTextBlock drops empty lines.
const CC_REDIRECT_LINES = Object.freeze([
    'Instagram, TikTok, and YouTube creators now sign up and get tracked in the GC mobile app. Ballhead no longer handles CC applications or progress.\n',
    `**1.** Get the GC mobile app: ${GC_MOBILE_LINKS}`,
    '**2.** Link your Instagram, TikTok, or YouTube account in the app.',
    `**3.** Connect your Discord at ${VERIFY_DISCORD_URL}, then run \`/cc_status\` in <#${GYM_CLASS_COMMANDS_CHANNEL_ID}> to see your status and weekly points.\n`,
    '**More Gym Class bot commands**',
    '- `/cc_post_feedback` - see the quality score for one of your posts',
    '- `/claim_roles` - claim your creator role perks',
    '- `/cc_chat` - ask questions about the creator program\n',
    'To earn Content Creator: 50+ followers and 8+ points a week, 3 weeks in a row.',
    `Still stuck? Open a ticket in <#${CC_SUPPORT_CHANNEL_ID}>.`,
]);

function ccRedirectPayload(title) {
    return noticePayload([...CC_REDIRECT_LINES], { title });
}

function replyWithCcRedirect(interaction, title) {
    const payload = ccRedirectPayload(title);
    return interaction.reply({ ...payload, flags: payload.flags | MessageFlags.Ephemeral });
}

module.exports = {
    GC_MOBILE_LINKS,
    VERIFY_DISCORD_URL,
    ccRedirectPayload,
    replyWithCcRedirect,
};
