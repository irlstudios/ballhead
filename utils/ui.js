'use strict';

const { TextDisplayBuilder, ContainerBuilder, MessageFlags } = require('discord.js');

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

function buildNoticeContainer({ title = 'Notice', subtitle, lines } = {}) {
    const container = new ContainerBuilder();
    const block = buildTextBlock({ title, subtitle, lines });
    if (block) container.addTextDisplayComponents(block);
    return container;
}

function noticePayload(message, options = {}) {
    const lines = Array.isArray(message) ? message : [message];
    const container = buildNoticeContainer({ ...options, lines });
    return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

module.exports = {
    buildTextBlock,
    parseWeek,
    buildNoticeContainer,
    noticePayload,
};
