'use strict';

// Rich evidence messages for the moderation channel: automatic flag alerts
// and user reports share this layout. buildEvidenceSections is the pure
// content assembly (one string per visual section, separated in the
// container); buildEvidenceMessage wraps it in Components V2 with the clip
// attached as a File component.

const {
    AttachmentBuilder, ContainerBuilder, FileBuilder, MessageFlags,
    SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder,
} = require('discord.js');

const buildEvidenceSections = ({
    title, kicker, mentionLine, fields = [], transcript, actionsTaken = [], actionFailures = [],
}) => {
    const header = [
        `## ${title}`,
        kicker ? `-# ${kicker}` : null,
        mentionLine || null,
    ].filter(Boolean).join('\n');

    const detail = fields
        .map(([label, value]) => `**${label}**\n${value}`)
        .join('\n\n');

    const sections = [header, detail];

    if (transcript) {
        const quoted = transcript.split('\n').map((line) => `> ${line}`).join('\n');
        sections.push(`### What was said\n${quoted}`);
    }

    const actionLines = [
        ...actionsTaken.map((action) => `- ${action}`),
        ...actionFailures.map((failure) => `- ${failure}`),
    ];
    sections.push(`### Bot action\n${actionLines.length > 0 ? actionLines.join('\n') : '- No action taken'}`);

    return sections;
};

const buildEvidenceMessage = ({
    accentColor, clipWav, fileName, allowedMentions = { parse: [] }, ...content
}) => {
    const container = new ContainerBuilder().setAccentColor(accentColor);
    const sections = buildEvidenceSections(content);
    sections.forEach((section, index) => {
        if (index > 0) {
            container.addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
            );
        }
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(section));
    });
    const files = [];
    if (clipWav && fileName) {
        container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
        container.addFileComponents(new FileBuilder().setURL(`attachment://${fileName}`));
        files.push(new AttachmentBuilder(clipWav, { name: fileName }));
    }
    return {
        flags: MessageFlags.IsComponentsV2,
        components: [container],
        files,
        allowedMentions,
    };
};

module.exports = { buildEvidenceSections, buildEvidenceMessage };
