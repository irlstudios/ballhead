'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder } = require('discord.js');
const { createCanvas, loadImage } = require('canvas');
const { request } = require('undici');
const logger = require('../utils/logger');
const { buildTextBlock, noticePayload } = require('../utils/ui');
const {
    findLfgParticipantQueues,
    updateLfgParticipants,
    findLfgQueueByKey,
    findLfgQueueByThreadId,
    findLfgParticipantsByKey,
    upsertLfgQueue,
} = require('../db');
const { GYM_CLASS_GENERAL_CHANNEL_ID } = require('../config/constants');

const LFG_QUEUES = Object.freeze([
    Object.freeze({ key: 'casual_1v1', name: 'Casual 1v1', size: 2, description: 'Casual 1v1 matches.' }),
    Object.freeze({ key: 'casual_2v2', name: 'Casual 2v2', size: 4, description: 'Casual 2v2 matches.' }),
    Object.freeze({ key: 'comp_1v1', name: 'Comp 1v1', size: 2, description: 'Competitive 1v1 matches.' }),
    Object.freeze({ key: 'comp_2v2', name: 'Comp 2v2', size: 4, description: 'Competitive 2v2 matches.' }),
]);

const lfgEnsureState = async (client, key) => {
    if (!client.lfgQueues) client.lfgQueues = new Map();
    if (client.lfgQueues.has(key)) return client.lfgQueues.get(key);
    const participants = await findLfgParticipantsByKey(key);
    const s = new Set(participants);
    client.lfgQueues.set(key, s);
    return s;
};

const lfgRemoveFromOtherQueues = async (client, userId, targetQueueKey) => {
    const rows = await findLfgParticipantQueues(userId, targetQueueKey);
    for (const row of rows) {
        const newParticipants = row.participants.filter(p => p !== userId);
        await updateLfgParticipants(row.thread_id, newParticipants);
        const set = await lfgEnsureState(client, row.queue_key);
        set.delete(userId);
        const qDef = LFG_QUEUES.find(q => q.key === row.queue_key);
        try {
            const thread = await client.channels.fetch(row.thread_id).catch(() => null);
            if (thread && thread.isThread()) {
                await lfgUpdateStarterMessage(thread, qDef, set);
            }
        } catch (error) {
            logger.error('Failed to update LFG starter message during removal:', error);
        }
    }
};

const lfgGetStatus = (members, queueDef) => {
    return members.size >= queueDef.size ? 'ready' : 'waiting';
};

const lfgBuildButtons = (key) => {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`lfg:join:${key}`).setLabel('Join').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`lfg:leave:${key}`).setLabel('Leave').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`lfg:status:${key}`).setLabel('Status').setStyle(ButtonStyle.Primary)
    );
};

const lfgBuildContainer = (queue, members, imageName) => {
    const list = members.size ? [...members].map(id => `<@${id}>`).join(' \u2022 ') : 'None';
    const container = new ContainerBuilder();
    const block = buildTextBlock({
        title: `${queue.name} Queue`,
        subtitle: queue.description || 'Queue status',
        lines: [
            `**Players Needed:** ${members.size}/${queue.size}`,
            `**Waiting:** ${list}`,
            'Use the buttons below to join or leave the queue.',
        ],
    });
    if (block) container.addTextDisplayComponents(block);
    if (imageName) {
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL(`attachment://${imageName}`)
            )
        );
    }
    return container;
};

const fetchBuffer = async (url) => {
    const res = await request(url);
    const ab = await res.body.arrayBuffer();
    return Buffer.from(ab);
};

const generateQueueImage = async (queue, members) => {
    const bgBuf = await fetchBuffer('https://cdn.ballhead.app/web_assets/FORCDN.jpg');
    const bg = await loadImage(bgBuf);
    const canvas = createCanvas(bg.width, bg.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bg, 0, 0, bg.width, bg.height);
    const txt = `${members.size}/${queue.size}`;
    const fs = Math.floor(bg.height * 0.12);
    ctx.font = `bold ${fs}px Sans-Serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = Math.max(6, Math.floor(bg.height * 0.01));
    const tx = Math.floor(bg.width / 2);
    const ty = Math.floor(bg.height * 0.8);
    const textWidth = ctx.measureText(txt).width;
    const headR = Math.floor(fs * 0.22);
    const iconGap = Math.floor(fs * 0.35);
    const headCx = Math.floor(tx - textWidth / 2 - iconGap - 20);
    const headCy = Math.floor(ty - headR);
    ctx.beginPath();
    ctx.arc(headCx, headCy, headR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    const bodyW = Math.floor(headR * 2.6);
    const bodyH = Math.floor(headR * 2.2);
    const bodyX = Math.floor(headCx - bodyW / 2);
    const bodyY = Math.floor(headCy + headR * 0.9);
    const rr = Math.floor(headR * 0.6);
    ctx.beginPath();
    ctx.moveTo(bodyX + rr, bodyY);
    ctx.lineTo(bodyX + bodyW - rr, bodyY);
    ctx.arc(bodyX + bodyW - rr, bodyY + rr, rr, -Math.PI / 2, 0);
    ctx.lineTo(bodyX + bodyW, bodyY + bodyH - rr);
    ctx.arc(bodyX + bodyW - rr, bodyY + bodyH - rr, rr, 0, Math.PI / 2);
    ctx.lineTo(bodyX + rr, bodyY + bodyH);
    ctx.arc(bodyX + rr, bodyY + bodyH - rr, rr, Math.PI / 2, Math.PI);
    ctx.lineTo(bodyX, bodyY + rr);
    ctx.arc(bodyX + rr, bodyY + rr, rr, Math.PI, Math.PI * 1.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeText(txt, tx, ty);
    ctx.fillText(txt, tx, ty);
    const buffer = canvas.toBuffer('image/png');
    const name = `${queue.key}.png`;
    return { attachment: buffer, name };
};

const lfgUpdateStarterMessage = async (thread, queueDef, members) => {
    const starter = await thread.fetchStarterMessage().catch(() => null);
    if (!starter) return;
    const img = await generateQueueImage(queueDef, members);
    const isV2 = starter?.flags?.has?.(MessageFlags.IsComponentsV2);
    if (!isV2) {
        try {
            await starter.edit({ embeds: [] });
        } catch (error) {
            logger.warn('Failed to clear legacy embeds before v2 update:', error?.message || error);
            return;
        }
    }
    const editOptions = {
        files: [img],
        flags: MessageFlags.IsComponentsV2,
        components: [lfgBuildContainer(queueDef, members, img.name), lfgBuildButtons(queueDef.key)],
    };
    if (isV2) {
        delete editOptions.flags;
    }
    await starter.edit(editOptions);
};

const handleLfgButton = async (interaction) => {
    try {
        await interaction.deferReply({ flags: 64 });
        if (!interaction.channel || !interaction.channel.isThread()) {
            await interaction.editReply(
                noticePayload('This button can only be used inside its queue thread.', { title: 'Queue Action', subtitle: 'Wrong Channel' })
            );
            return;
        }
        const parts = interaction.customId.split(':');
        const lfgAction = parts[1];
        const lfgKey = parts[2];
        let queueDef = null;
        if (lfgKey) queueDef = await findLfgQueueByKey(lfgKey);
        if (!queueDef && interaction.channel?.id) {
            queueDef = await findLfgQueueByThreadId(interaction.channel.id);
        }
        if (!queueDef) {
            queueDef = LFG_QUEUES.find(q => q.key === lfgKey) || null;
        }
        if (!queueDef && interaction.channel) {
            queueDef = LFG_QUEUES.find(q => q.name === interaction.channel.name) || null;
        }
        if (!queueDef) {
            await interaction.editReply(noticePayload('Queue not found for this thread.', { title: 'Queue Not Found', subtitle: 'LFG Queue' }));
            return;
        }
        const members = await lfgEnsureState(interaction.client, queueDef.key);
        if (!members) {
            await interaction.editReply(noticePayload('Queue state unavailable.', { title: 'Queue Unavailable', subtitle: queueDef.name }));
            return;
        }
        if (lfgAction === 'join') {
            await handleLfgJoin(interaction, queueDef, members);
        } else if (lfgAction === 'leave') {
            await handleLfgLeave(interaction, queueDef, members);
        } else if (lfgAction === 'status') {
            const status = lfgGetStatus(members, queueDef);
            await upsertLfgQueue(interaction.channel.id, queueDef, Array.from(members), status);
            await interaction.editReply(noticePayload(`${members.size}/${queueDef.size} waiting in ${queueDef.name}.`, { title: 'Queue Status', subtitle: queueDef.name }));
        }
    } catch (error) {
        logger.error('Button Error', error);
        try {
            if (!interaction.deferred && !interaction.replied) {
                await interaction.reply({ ...noticePayload('An error occurred while processing this button.', { title: 'Action Failed', subtitle: 'LFG Queue' }), ephemeral: true });
            } else {
                await interaction.editReply(noticePayload('An error occurred while processing this button.', { title: 'Action Failed', subtitle: 'LFG Queue' }));
            }
        } catch (replyError) {
            logger.error('Failed to send error response for button interaction:', replyError);
        }
    }
};

const handleLfgJoin = async (interaction, queueDef, members) => {
    if (members.has(interaction.user.id)) {
        await interaction.editReply(noticePayload(`You are already in ${queueDef.name}.`, { title: 'Already Joined', subtitle: queueDef.name }));
        return;
    }
    await lfgRemoveFromOtherQueues(interaction.client, interaction.user.id, queueDef.key);
    members.add(interaction.user.id);
    const ordered = [...members];
    if (ordered.length >= queueDef.size) {
        const picks = ordered.slice(0, queueDef.size);
        const remaining = ordered.slice(queueDef.size);
        members.clear();
        for (const id of remaining) members.add(id);
        await lfgUpdateStarterMessage(interaction.channel, queueDef, members);
        const status = lfgGetStatus(members, queueDef);
        await upsertLfgQueue(interaction.channel.id, queueDef, Array.from(members), status);
        await notifyMatchReady(interaction.client, picks, queueDef);
        if (picks.includes(interaction.user.id)) {
            await interaction.editReply(noticePayload(`Match ready in ${queueDef.name}.`, { title: 'Match Ready', subtitle: queueDef.name }));
        } else {
            const pos = remaining.indexOf(interaction.user.id) + 1;
            await interaction.editReply(noticePayload(`Joined ${queueDef.name}. You are in the wait list at position ${pos}.`, { title: 'Queued', subtitle: queueDef.name }));
        }
        return;
    }
    await lfgUpdateStarterMessage(interaction.channel, queueDef, members);
    const status = lfgGetStatus(members, queueDef);
    await upsertLfgQueue(interaction.channel.id, queueDef, Array.from(members), status);
    await interaction.editReply(noticePayload(`Joined ${queueDef.name}.`, { title: 'Queued', subtitle: queueDef.name }));
};

const handleLfgLeave = async (interaction, queueDef, members) => {
    if (!members.has(interaction.user.id)) {
        await interaction.editReply(noticePayload(`You are not in ${queueDef.name}.`, { title: 'Not In Queue', subtitle: queueDef.name }));
        return;
    }
    members.delete(interaction.user.id);
    await lfgUpdateStarterMessage(interaction.channel, queueDef, members);
    const status = lfgGetStatus(members, queueDef);
    await upsertLfgQueue(interaction.channel.id, queueDef, Array.from(members), status);
    await interaction.editReply(noticePayload(`Left ${queueDef.name}.`, { title: 'Queue Updated', subtitle: queueDef.name }));
};

const notifyMatchReady = async (client, picks, queueDef) => {
    let fallback = null;
    try {
        fallback = await client.channels.fetch(GYM_CLASS_GENERAL_CHANNEL_ID);
    } catch (fetchError) {
        logger.error('Failed to fetch fallback channel for queue notification:', fetchError);
    }
    const gym = (queueDef.lobby_display_name && queueDef.lobby_display_name.trim().length > 0) ? queueDef.lobby_display_name : 'the gym';
    for (const uid of picks) {
        const others = picks.filter(id => id !== uid);
        let delivered = false;
        try {
            const user = await client.users.fetch(uid);
            await user.send(noticePayload(
                [`**Queue:** ${queueDef.name}`, `**Opponent(s):** ${others.map(id => `<@${id}>`).join(' ') || 'TBD'}`, `**Lobby:** ${gym}`, 'Your match is ready. Head in and play!'],
                { title: 'Match Ready', subtitle: queueDef.name }
            ));
            delivered = true;
        } catch (dmError) {
            logger.error('Failed to notify user about LFG queue update:', dmError);
        }
        if (!delivered && fallback) {
            await fallback.send(noticePayload(
                [`<@${uid}>`, `**Queue:** ${queueDef.name}`, `**Opponent(s):** ${others.map(id => `<@${id}>`).join(' ') || 'TBD'}`, `**Lobby:** ${gym}`, 'Your match is ready. Head in and play!'],
                { title: 'Match Ready', subtitle: queueDef.name }
            ));
        }
    }
};

module.exports = {
    handleLfgButton,
    lfgEnsureState,
    lfgBuildButtons,
    lfgBuildContainer,
    lfgUpdateStarterMessage,
    generateQueueImage,
    LFG_QUEUES,
};
