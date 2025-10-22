const { ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Events, Collection, ThreadAutoArchiveDuration } = require('discord.js');
const { Client } = require('pg');
const { createCanvas, loadImage } = require('canvas');
const { request } = require('undici');
const clientConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    database: process.env.DB_DATABASE_NAME,
    password: process.env.DB_PASSWORD,
    ssl: { rejectUnauthorized: false }
};

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

function buildEmbed(queue, members, imageName) {
    const list = members.size ? [...members].map(id => `<@${id}>`).join(' \u2022 ') : 'None';
    const e = new EmbedBuilder()
        .setTitle(`${queue.name} Queue`)
        .setDescription(queue.description)
        .addFields(
            { name: 'Players Needed', value: `${members.size}/${queue.size}`, inline: true },
            { name: 'Waiting', value: list, inline: false }
        );
    if (imageName) e.setImage(`attachment://${imageName}`);
    return e;
}

async function fetchBuffer(url) {
    const res = await request(url);
    const ab = await res.body.arrayBuffer();
    return Buffer.from(ab);
}

async function generateQueueImage(client, queue, members) {
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
}

async function persistQueueThread(threadId, q, members) {
    const pgClient = new Client(clientConfig);
    await pgClient.connect();
    const participants = Array.from(members);
    await pgClient.query(
        `INSERT INTO lfg_queues(thread_id, queue_key, queue_name, size, status, participants, updated_at)
     VALUES($1,$2,$3,$4,$5,$6,NOW())
     ON CONFLICT (thread_id) DO UPDATE SET queue_key=EXCLUDED.queue_key, queue_name=EXCLUDED.queue_name, size=EXCLUDED.size, status=EXCLUDED.status, participants=EXCLUDED.participants, updated_at=NOW()`,
        [threadId, q.key, q.name, q.size, 'waiting', participants]
    );
    await pgClient.end();
}

async function deleteQueueRow(threadId) {
    const pgClient = new Client(clientConfig);
    await pgClient.connect();
    await pgClient.query('DELETE FROM lfg_queues WHERE thread_id = $1', [threadId]);
    await pgClient.end();
}

async function loadAllQueueDefs() {
    const pgClient = new Client(clientConfig);
    await pgClient.connect();
    const res = await pgClient.query('SELECT thread_id, queue_key, queue_name, size, \'Queue\' as description FROM lfg_queues ORDER BY updated_at DESC');
    await pgClient.end();
    return res.rows.map(r => ({
        id: r.thread_id,
        key: r.queue_key,
        name: r.queue_name,
        size: r.size,
        description: r.description
    }));
}

async function updateThreadIdForQueue(queueKey, threadId) {
    const pgClient = new Client(clientConfig);
    await pgClient.connect();
    await pgClient.query('UPDATE lfg_queues SET thread_id = $1, updated_at = NOW() WHERE queue_key = $2', [threadId, queueKey]);
    await pgClient.end();
}

async function getQueueByNameFromDb(name) {
    const pgClient = new Client(clientConfig);
    await pgClient.connect();
    const res = await pgClient.query('SELECT thread_id, queue_key, queue_name, size, \'Queue\' as description FROM lfg_queues WHERE queue_name = $1 LIMIT 1', [name]);
    await pgClient.end();
    if (!res.rows[0]) return null;
    return { id: res.rows[0].thread_id, key: res.rows[0].queue_key, name: res.rows[0].queue_name, size: res.rows[0].size, description: res.rows[0].description };
}

async function pruneStaleQueueRows(client) {
    const forum = await client.channels.fetch(FORUM_CHANNEL_ID);
    if (!forum || forum.type !== ChannelType.GuildForum) return;
    const active = await forum.threads.fetchActive();
    const archived = await forum.threads.fetchArchived({ limit: 100 });
    const existingIds = new Set([
        ...active.threads.map(t => t.id),
        ...archived.threads.map(t => t.id)
    ]);
    const pgClient = new Client(clientConfig);
    await pgClient.connect();
    const res = await pgClient.query('SELECT thread_id FROM lfg_queues');
    for (const row of res.rows) {
        if (!existingIds.has(row.thread_id)) {
            await pgClient.query('DELETE FROM lfg_queues WHERE thread_id = $1', [row.thread_id]);
        }
    }
    await pgClient.end();
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
                message: { files: [img], embeds: [buildEmbed(q, ensureQueueState(q.key), img.name)], components: [buildButtons(q.key)] }
            });
            thread = created;
            try { await thread.pin(); } catch (error) { console.error('Failed to pin queue thread:', error); }
            await updateThreadIdForQueue(q.key, thread.id);
        } else {
            const starter = await thread.fetchStarterMessage().catch(() => null);
            if (starter) {
                const img = await generateQueueImage(client, q, ensureQueueState(q.key));
                await starter.edit({ files: [img], embeds: [buildEmbed(q, ensureQueueState(q.key), img.name)], components: [buildButtons(q.key)] });
            }
            if (!q.id || q.id !== thread.id) await updateThreadIdForQueue(q.key, thread.id);
        }
        state.threadToQueueKey.set(thread.id, q.key);
        if (!thread.archived) await persistQueueThread(thread.id, q, ensureQueueState(q.key));
    }
}

module.exports = {
    name: 'ready',
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
                    await starter.edit({ files: [img], embeds: [buildEmbed(q, members, img.name)], components: [buildButtons(q.key)] });
                }
                await updateThreadIdForQueue(q.key, thread.id);
                await persistQueueThread(thread.id, q, members);
            } catch (error) { console.error('Failed to refresh queue thread after creation:', error); }
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
                    await starter.edit({ files: [img], embeds: [buildEmbed(q, members, img.name)], components: [buildButtons(q.key)] });
                }
                await updateThreadIdForQueue(q.key, newThread.id);
                await persistQueueThread(newThread.id, q, members);
            } catch (error) { console.error('Failed to refresh queue thread after update:', error); }
        });
        client.on('lfg:refresh', async () => {
            await ensureQueueThreads(client);
        });
    }
};
