const { ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ContainerBuilder, TextDisplayBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, Events, Collection, ThreadAutoArchiveDuration, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');
const { executeQuery, loadAllLfgParticipants } = require('../db');
const logger = require('../utils/logger');
const { createCanvas, loadImage } = require('canvas');
const { request } = require('undici');

const FORUM_CHANNEL_ID = '1409691288307105822';

const state = {
    queues: new Collection(),
    threadToQueueKey: new Collection()
};

let queueDefinitions = [];

function upsertQueueDefinition(definition) {
    const index = queueDefinitions.findIndex(entry => entry.key === definition.key);
    if (index === -1) {
        queueDefinitions.push(definition);
    } else {
        queueDefinitions[index] = definition;
    }
}

function ensureQueueState(key) {
    if (!state.queues.has(key)) state.queues.set(key, new Set());
    return state.queues.get(key);
}

function buildButtons(key) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`lfg:join:${key}`).setLabel('Join').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`lfg:leave:${key}`).setLabel('Leave').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`lfg:status:${key}`).setLabel('Status').setStyle(ButtonStyle.Primary)
    );
}

function buildContainer(queue, members, imageName) {
    const list = members.size ? [...members].map(id => `<@${id}>`).join(' • ') : 'No one yet';
    const isFull = members.size >= queue.size;
    const container = new ContainerBuilder()
        .setAccentColor(isFull ? 0x2ECC71 : 0x14B8A6);

    if (imageName) {
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${imageName}`))
        );
    }

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`## ${queue.name}`),
        new TextDisplayBuilder().setContent(`${members.size}/${queue.size} players`)
    );
    container.addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    );
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`**Waiting**\n${list}`)
    );

    return container;
}

async function ensureV2StarterMessage(starter, options) {
    if (!starter) return null;
    const isV2 = starter?.flags?.has?.(MessageFlags.IsComponentsV2);
    if (!isV2) {
        try {
            starter = await starter.edit({ embeds: [] });
        } catch (error) {
            logger.warn('Failed to clear legacy embeds before v2 update:', error?.message || error);
            return null;
        }
    }
    const editOptions = { ...options };
    if (isV2) {
        delete editOptions.flags;
    }
    return starter.edit(editOptions);
}

async function fetchBuffer(url) {
    const res = await request(url);
    const ab = await res.body.arrayBuffer();
    return Buffer.from(ab);
}

async function generateQueueImage(client, queue, members) {
    let canvas;
    let ctx;
    try {
        const bgBuf = await fetchBuffer('https://cdn.ballhead.app/web_assets/FORCDN.jpg');
        const bg = await loadImage(bgBuf);
        canvas = createCanvas(bg.width, bg.height);
        ctx = canvas.getContext('2d');
        ctx.drawImage(bg, 0, 0, bg.width, bg.height);
    } catch (err) {
        logger.warn('[LFG] CDN background image unavailable, using fallback:', err.message);
        canvas = createCanvas(800, 400);
        ctx = canvas.getContext('2d');
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, 800, 400);
    }
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
}

async function persistQueueThread(threadId, q, members) {
    const participants = Array.from(members);
    await executeQuery(
        `INSERT INTO lfg_queues(thread_id, queue_key, queue_name, size, status, participants, updated_at)
     VALUES($1,$2,$3,$4,$5,$6,NOW())
     ON CONFLICT (thread_id) DO UPDATE SET queue_key=EXCLUDED.queue_key, queue_name=EXCLUDED.queue_name, size=EXCLUDED.size, status=EXCLUDED.status, participants=EXCLUDED.participants, updated_at=NOW()`,
        [threadId, q.key, q.name, q.size, 'waiting', participants]
    );
}

async function deleteQueueRow(threadId) {
    await executeQuery('DELETE FROM lfg_queues WHERE thread_id = $1', [threadId]);
}

async function loadAllQueueDefs() {
    const res = await executeQuery('SELECT thread_id, queue_key, queue_name, size, \'Queue\' as description FROM lfg_queues ORDER BY updated_at DESC');
    return res.rows.map(r => ({
        id: r.thread_id,
        key: r.queue_key,
        name: r.queue_name,
        size: r.size,
        description: r.description
    }));
}

async function updateThreadIdForQueue(queueKey, threadId) {
    await executeQuery('UPDATE lfg_queues SET thread_id = $1, updated_at = NOW() WHERE queue_key = $2', [threadId, queueKey]);
}

async function getQueueByNameFromDb(name) {
    const res = await executeQuery('SELECT thread_id, queue_key, queue_name, size, \'Queue\' as description FROM lfg_queues WHERE queue_name = $1 LIMIT 1', [name]);
    if (!res.rows[0]) return null;
    return { id: res.rows[0].thread_id, key: res.rows[0].queue_key, name: res.rows[0].queue_name, size: res.rows[0].size, description: res.rows[0].description };
}

async function pruneStaleQueueRows(client) {
    const forum = await client.channels.fetch(FORUM_CHANNEL_ID);
    if (!forum || forum.type !== ChannelType.GuildForum) return;
    const active = await forum.threads.fetchActive();
    const archivedAll = await fetchAllArchivedThreads(forum);
    const existingIds = new Set([
        ...active.threads.map(t => t.id),
        ...archivedAll.map(t => t.id)
    ]);
    const res = await executeQuery('SELECT thread_id FROM lfg_queues');
    for (const row of res.rows) {
        if (!existingIds.has(row.thread_id)) {
            await executeQuery('DELETE FROM lfg_queues WHERE thread_id = $1', [row.thread_id]);
        }
    }
}

async function getThreadById(client, threadId) {
    try {
        const ch = await client.channels.fetch(threadId);
        if (ch && ch.isThread()) return ch;
        return null;
    } catch {
        return null;
    }
}

async function fetchAllArchivedThreads(forum) {
    const archived = [];
    let before = undefined;
    while (true) {
        const batch = await forum.threads.fetchArchived({ limit: 100, before });
        for (const t of batch.threads.values()) archived.push(t);
        if (!batch.hasMore) break;
        const oldest = batch.threads.at(-1);
        if (!oldest) break;
        before = oldest.id;
    }
    return archived;
}

async function findThreadByName(forum, name) {
    const active = await forum.threads.fetchActive();
    let found = active.threads.find(t => t.name === name);
    if (found) return found;
    const archivedAll = await fetchAllArchivedThreads(forum);
    found = archivedAll.find(t => t.name === name) || null;
    return found;
}

async function ensureQueueThreads(client) {
    const forum = await client.channels.fetch(FORUM_CHANNEL_ID);
    if (!forum || forum.type !== ChannelType.GuildForum) return;
    const defs = await loadAllQueueDefs();
    const allParticipants = await loadAllLfgParticipants();
    for (const row of allParticipants) {
        const members = ensureQueueState(row.queue_key);
        for (const userId of (row.participants || [])) {
            members.add(userId);
        }
    }
    queueDefinitions = [];
    for (const q of defs) {
        upsertQueueDefinition(q);
        let thread = null;
        if (q.id && !q.id.startsWith('pending:')) {
            thread = await getThreadById(client, q.id);
            if (!thread) await deleteQueueRow(q.id);
        }
        if (!thread) thread = await findThreadByName(forum, q.name);
        if (thread && thread.archived) await thread.setArchived(false, 'Reopening queue thread');
        if (!thread) {
            const img = await generateQueueImage(client, q, ensureQueueState(q.key));
            const created = await forum.threads.create({
                name: q.name,
                autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
                message: { files: [img], flags: MessageFlags.IsComponentsV2, components: [buildContainer(q, ensureQueueState(q.key), img.name), buildButtons(q.key)] }
            });
            thread = created;
            try { await thread.pin(); } catch (error) { logger.error('Failed to pin queue thread:', error); }
            await updateThreadIdForQueue(q.key, thread.id);
        } else {
            const starter = await thread.fetchStarterMessage().catch(() => null);
            if (starter) {
                const img = await generateQueueImage(client, q, ensureQueueState(q.key));
                await ensureV2StarterMessage(starter, {
                    files: [img],
                    flags: MessageFlags.IsComponentsV2,
                    components: [buildContainer(q, ensureQueueState(q.key), img.name), buildButtons(q.key)]
                });
            }
            if (!q.id || q.id !== thread.id) await updateThreadIdForQueue(q.key, thread.id);
        }
        state.threadToQueueKey.set(thread.id, q.key);
        if (!thread.archived) await persistQueueThread(thread.id, q, ensureQueueState(q.key));
    }
}

module.exports = {
    name: 'clientReady',
    once: true,
    async execute(client) {
        await ensureQueueThreads(client);
        await pruneStaleQueueRows(client);
        client.on(Events.ThreadCreate, async thread => {
            try {
                const forum = await thread.parent?.fetch().catch(() => null);
                if (!forum || forum.id !== FORUM_CHANNEL_ID) return;
                const q = await getQueueByNameFromDb(thread.name);
                if (!q) return;
                upsertQueueDefinition(q);
                state.threadToQueueKey.set(thread.id, q.key);
                const members = ensureQueueState(q.key);
                if (thread.archived) await thread.setArchived(false, 'Queue thread auto-reopen');
                const starter = await thread.fetchStarterMessage().catch(() => null);
                if (starter) {
                    const img = await generateQueueImage(thread.client, q, members);
                    await ensureV2StarterMessage(starter, {
                        files: [img],
                        flags: MessageFlags.IsComponentsV2,
                        components: [buildContainer(q, members, img.name), buildButtons(q.key)]
                    });
                }
                await updateThreadIdForQueue(q.key, thread.id);
                await persistQueueThread(thread.id, q, members);
            } catch (error) { logger.error('Failed to refresh queue thread after creation:', error); }
        });
        client.on(Events.ThreadDelete, async thread => {
            await deleteQueueRow(thread.id);
        });
        client.on(Events.ThreadUpdate, async (oldThread, newThread) => {
            try {
                const forum = await newThread.parent?.fetch().catch(() => null);
                if (!forum || forum.id !== FORUM_CHANNEL_ID) return;
                const q = await getQueueByNameFromDb(newThread.name);
                if (!q) return;
                upsertQueueDefinition(q);
                state.threadToQueueKey.set(newThread.id, q.key);
                const members = ensureQueueState(q.key);
                const starter = await newThread.fetchStarterMessage().catch(() => null);
                if (starter) {
                    const img = await generateQueueImage(newThread.client, q, members);
                    await ensureV2StarterMessage(starter, {
                        files: [img],
                        flags: MessageFlags.IsComponentsV2,
                        components: [buildContainer(q, members, img.name), buildButtons(q.key)]
                    });
                }
                await updateThreadIdForQueue(q.key, newThread.id);
                await persistQueueThread(newThread.id, q, members);
            } catch (error) { logger.error('Failed to refresh queue thread after update:', error); }
        });
        client.on('lfg:refresh', async () => {
            await ensureQueueThreads(client);
        });
    }
};
