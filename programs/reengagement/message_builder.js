'use strict';

const {
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
} = require('discord.js');
const { config } = require('./config');

// Custom-id scheme. Correlation (which program / which lapse) is recovered from
// the DB by (user_id, program); the id only needs the action and program.
const JUMP_ID = (program) => `reengage:jump:${program}`;
const DECLINE_ID = (program) => `reengage:decline:${program}`;

const num = (value, fallback = '0') => {
    const text = String(value ?? '').trim();
    return text === '' ? fallback : text;
};

// Pure copy generation (no Discord types) so the hype tone is unit-testable.
// Hype / competitive register: lead with their standing, frame it as something
// to defend, point at what is new, end with a challenge.
function buildHypeCopy({ member, changelog = [] }) {
    const name = member.inGameName || 'baller';
    const stats = member.achievements || {};
    const mmr = num(stats.mmr);
    const points = num(stats.points);
    const wins = num(stats.wins);

    const headline = `## ${name}, your spot is up for grabs.`;

    const standing = [
        `Back in **Season ${member.lastActiveSeason}** you put up **${points} points**, `
        + `**${wins} wins**, and a **${mmr} MMR**.`,
        'People have been climbing ever since.',
    ].join(' ');

    const changelogLines = changelog
        .map((item) => `- ${item}`)
        .filter(Boolean);

    const sinceYouLeft = changelogLines.length > 0
        ? ['**What changed since you left:**', ...changelogLines].join('\n')
        : '**Friendly Fire has not slowed down since you left.**';

    const challenge = 'Season is live with new rewards on the line. '
        + 'You gonna let them take your spot, or jump back in?';

    return { headline, standing, sinceYouLeft, challenge };
}

// Builds the full Components V2 DM payload, ready to pass to user.send().
function buildReengagementMessage({ member, changelog = [], program }) {
    const copy = buildHypeCopy({ member, changelog });

    const container = new ContainerBuilder()
        .setAccentColor(config.FF_ACCENT_COLOR)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(copy.headline),
            new TextDisplayBuilder().setContent(copy.standing),
        )
        .addSeparatorComponents(
            new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
        )
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(copy.sinceYouLeft),
        )
        .addSeparatorComponents(
            new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small),
        )
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(copy.challenge),
        );

    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(JUMP_ID(program))
            .setLabel('Jump back in')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(DECLINE_ID(program))
            .setLabel('Not right now')
            .setStyle(ButtonStyle.Secondary),
    );

    return {
        flags: MessageFlags.IsComponentsV2,
        components: [container, buttons],
    };
}

module.exports = {
    buildHypeCopy,
    buildReengagementMessage,
    JUMP_ID,
    DECLINE_ID,
};
