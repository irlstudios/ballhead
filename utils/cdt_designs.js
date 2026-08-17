'use strict';

const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    ComponentType,
    ContainerBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
} = require('discord.js');
const logger = require('./logger');
const { buildTextBlock, noticePayload } = require('./ui');
const { searchCdtDesigns, getCdtDesign, cdtTagStats } = require('../db');
const {
    CDT_LEAD_ROLE_ID,
    CDT_DESIGNS_FORUM_CHANNEL_ID,
    CDT_FORUM_TAGS,
    CDT_POPULAR_TAG_ID,
    CDT_MOST_DOWNLOADED_TAG_ID,
    CDT_POPULAR_THRESHOLD,
} = require('../config/constants');

const SUBTITLE = 'Community Design Team';
const CC_LINE = 'Released under CC BY-NC: free to use, share, and build on with credit to the designer. Commercial use is not allowed.';
// Categories are the forum's content tags, so an approved post is tagged with
// exactly the category the lead picked.
const CATEGORY_CHOICES = Object.keys(CDT_FORUM_TAGS).map((name) => ({ name, value: name }));
const MAX_PREVIEWS = 10;

const isCdtLead = (member) => member.roles.cache.has(CDT_LEAD_ROLE_ID);

// Replies (or edits the deferred reply) with a lead-only notice. Returns true
// when the caller should stop.
const rejectNonLead = async (interaction) => {
    if (isCdtLead(interaction.member)) {
        return false;
    }
    const payload = {
        ...noticePayload(
            'Only Community Design Team leads can use this command.',
            { title: 'Team Leads Only', subtitle: SUBTITLE }
        ),
        ephemeral: true,
    };
    if (interaction.deferred || interaction.replied) {
        await interaction.editReply(payload);
    } else {
        await interaction.reply(payload);
    }
    return true;
};

const parseMessageLink = (link) => {
    const match = /discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)/.exec((link || '').trim());
    if (!match) {
        return null;
    }
    return { guildId: match[1], channelId: match[2], messageId: match[3] };
};

// Resolves a message link to a message with attachments, or an { error }
// string suitable for showing the lead directly.
const fetchLinkedMessage = async (interaction, link) => {
    const parsed = parseMessageLink(link);
    if (!parsed) {
        return { error: 'That is not a Discord message link. Right-click the submission message and choose Copy Message Link.' };
    }
    if (parsed.guildId !== interaction.guild.id) {
        return { error: 'The linked message must be in this server.' };
    }
    let message = null;
    try {
        // Guild-scoped fetch so a link that names this guild but points at a
        // channel in another shared server cannot resolve.
        const channel = await interaction.guild.channels.fetch(parsed.channelId);
        if (channel?.isTextBased()) {
            message = await channel.messages.fetch(parsed.messageId);
        }
    } catch (error) {
        logger.error('Failed to fetch linked CDT message:', error);
    }
    if (!message) {
        return { error: 'I could not read that message. Check the link and that I can see the channel.' };
    }
    if (message.attachments.size === 0) {
        return { error: 'The linked message has no attached files.' };
    }
    return { message };
};

const fileExtension = (name) => {
    const match = /\.([A-Za-z0-9]+)$/.exec(name || '');
    return match ? match[1].toLowerCase() : 'png';
};

const isImageAttachment = (attachment) =>
    (attachment.contentType || '').startsWith('image/') ||
    ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(fileExtension(attachment.name));

// All attachments, re-uploadable by URL (discord.js fetches and re-uploads).
const toFilePayloads = (message) =>
    [...message.attachments.values()].map((a) => ({ attachment: a.url, name: a.name }));

// Image attachments renamed deterministically so attachment:// references in
// the media gallery are stable across posts and edits. Attachments serving as
// downloadable design files are excluded so they never show publicly.
const toPreviewPayloads = (message, excludeIds = new Set()) =>
    [...message.attachments.values()]
        .filter((a) => isImageAttachment(a) && !excludeIds.has(a.id))
        .slice(0, MAX_PREVIEWS)
        .map((a, i) => ({ attachment: a.url, name: `preview-${i + 1}.${fileExtension(a.name)}` }));

// Direct Discord attachment link (right click an attachment, copy link).
// Normalized to cdn.discordapp.com with only the signature params kept, since
// media.discordapp.net serves converted images (webp, resized) and the design
// file must be stored byte for byte.
const parseAttachmentUrl = (value) => {
    let url;
    try {
        url = new URL((value || '').trim());
    } catch {
        return null;
    }
    if (url.hostname !== 'cdn.discordapp.com' && url.hostname !== 'media.discordapp.net') {
        return null;
    }
    const match = /^\/attachments\/(\d+)\/(\d+)\/([^/]+)$/.exec(url.pathname);
    if (!match) {
        return null;
    }
    const normalized = new URL(`https://cdn.discordapp.com${url.pathname}`);
    for (const key of ['ex', 'is', 'hm']) {
        const param = url.searchParams.get(key);
        if (param) {
            normalized.searchParams.set(key, param);
        }
    }
    return {
        channelId: match[1],
        attachmentId: match[2],
        name: decodeURIComponent(match[3]),
        url: normalized.toString(),
    };
};

// Preview sources of an already-published post. Fetched ComponentsV2 messages
// expose gallery uploads only inside the component tree, never in
// message.attachments (verified against the live API), so rebuilding a post
// must read the media gallery items.
const extractGalleryPayloads = (components) => {
    const payloads = [];
    for (const component of components || []) {
        const json = typeof component.toJSON === 'function' ? component.toJSON() : component;
        if (json.type === ComponentType.MediaGallery) {
            for (const item of json.items || []) {
                const parsed = item.media?.url ? parseAttachmentUrl(item.media.url) : null;
                if (parsed) {
                    payloads.push({ attachment: parsed.url, name: parsed.name });
                }
            }
        }
        payloads.push(...extractGalleryPayloads(json.components));
    }
    return payloads;
};

// The files option accepts either one message link (all its attachments) or
// one or more attachment links separated by spaces. Returns { files,
// attachmentIds, messageId? } or { error }.
const resolveFilesInput = async (interaction, value) => {
    const tokens = (value || '').trim().split(/\s+/).filter(Boolean);
    const parsed = tokens.map(parseAttachmentUrl);
    if (tokens.length > 0 && parsed.every(Boolean)) {
        return {
            files: parsed.map((a) => ({ attachment: a.url, name: a.name })),
            attachmentIds: new Set(parsed.map((a) => a.attachmentId)),
        };
    }
    if (tokens.length === 1) {
        const { message, error } = await fetchLinkedMessage(interaction, tokens[0]);
        if (error) {
            return { error };
        }
        return {
            files: toFilePayloads(message),
            attachmentIds: new Set(message.attachments.keys()),
            messageId: message.id,
        };
    }
    return { error: 'The files option must be one message link, or one or more attachment links (right click the file, Copy Link) separated by spaces.' };
};

const buildDesignPostPayload = ({ designId, title, category, description, designerId, creditName, previewNames }) => {
    const container = new ContainerBuilder();
    const block = buildTextBlock({
        title,
        subtitle: `${category} | designed by ${creditName}`,
        lines: [
            description,
            '',
            `**Designer:** <@${designerId}>`,
            CC_LINE,
            '',
            'Press **Get Files** below to download this design.',
        ],
    });
    if (block) container.addTextDisplayComponents(block);
    if (previewNames.length > 0) {
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                previewNames.map((name) => new MediaGalleryItemBuilder().setURL(`attachment://${name}`))
            )
        );
    }
    container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`cdtDownload_${designId}`)
                .setLabel('Get Files')
                .setStyle(ButtonStyle.Primary)
        )
    );
    return { flags: MessageFlags.IsComponentsV2, components: [container] };
};

const fetchDesignsForum = async (client) => {
    try {
        const channel = await client.channels.fetch(CDT_DESIGNS_FORUM_CHANNEL_ID);
        return channel?.type === ChannelType.GuildForum ? channel : null;
    } catch (error) {
        logger.error('Failed to fetch CDT designs forum channel:', error);
        return null;
    }
};

const fetchDesignThread = async (client, design) => {
    try {
        const thread = await client.channels.fetch(design.forum_thread_id);
        return thread?.isThread() ? thread : null;
    } catch (error) {
        logger.error(`Failed to fetch CDT forum thread for design ${design.design_id}:`, error);
        return null;
    }
};

// What a thread's tags should be, given its current tags and download stats.
// Manually-added and category tags are preserved; only Popular and Most
// Downloaded are managed. Discord caps applied tags at 5.
const desiredTags = (appliedTags, downloads, isTopDesign) => {
    const tags = appliedTags.filter((tag) => tag !== CDT_POPULAR_TAG_ID && tag !== CDT_MOST_DOWNLOADED_TAG_ID);
    if (downloads >= CDT_POPULAR_THRESHOLD) {
        tags.push(CDT_POPULAR_TAG_ID);
    }
    if (isTopDesign) {
        tags.push(CDT_MOST_DOWNLOADED_TAG_ID);
    }
    return tags.slice(0, 5);
};

// Re-applies Popular and Most Downloaded across every design thread. Called
// after downloads and removals; never throws.
// ponytail: full sweep per download, batch into a cron job if the forum grows
// past a few hundred designs.
const reconcileCdtTags = async (client) => {
    try {
        const rows = await cdtTagStats();
        const topDesignId = rows.length > 0 && rows[0].downloads > 0 ? rows[0].design_id : null;
        for (const row of rows) {
            const thread = await fetchDesignThread(client, row);
            if (!thread) {
                continue;
            }
            const tags = desiredTags(thread.appliedTags, row.downloads, row.design_id === topDesignId);
            const unchanged = tags.length === thread.appliedTags.length
                && tags.every((tag) => thread.appliedTags.includes(tag));
            if (!unchanged) {
                await thread.setAppliedTags(tags);
            }
        }
    } catch (error) {
        logger.error('Failed to reconcile CDT forum tags:', error);
    }
};

// Shared autocomplete for the design option on /cdt update and /cdt remove.
const respondDesignAutocomplete = async (interaction) => {
    try {
        const query = interaction.options.getFocused() || '';
        const rows = await searchCdtDesigns(query);
        await interaction.respond(
            rows.map((row) => ({
                name: `#${row.design_id} ${row.title} (${row.category})`.slice(0, 100),
                value: String(row.design_id),
            }))
        );
    } catch (error) {
        logger.error('CDT design autocomplete error:', error);
    }
};

// Resolves the design option to a row, or replies with an error and returns
// null. Expects the interaction to already be deferred.
const resolveDesignOption = async (interaction) => {
    const raw = interaction.options.getString('design');
    const designId = Number.parseInt(raw, 10);
    const design = Number.isInteger(designId) ? await getCdtDesign(designId) : null;
    if (!design) {
        await interaction.editReply({
            ...noticePayload(
                'That design was not found. Pick one from the autocomplete list.',
                { title: 'Design Not Found', subtitle: SUBTITLE }
            ),
            ephemeral: true,
        });
        return null;
    }
    return design;
};

module.exports = {
    SUBTITLE,
    CC_LINE,
    CATEGORY_CHOICES,
    isCdtLead,
    rejectNonLead,
    parseMessageLink,
    fetchLinkedMessage,
    fileExtension,
    isImageAttachment,
    toFilePayloads,
    toPreviewPayloads,
    parseAttachmentUrl,
    resolveFilesInput,
    extractGalleryPayloads,
    buildDesignPostPayload,
    fetchDesignsForum,
    fetchDesignThread,
    desiredTags,
    reconcileCdtTags,
    respondDesignAutocomplete,
    resolveDesignOption,
};
