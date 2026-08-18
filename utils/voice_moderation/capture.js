'use strict';

// Joins the session voice channel and keeps a rolling window of every
// speaker's opus packets so an incident can be clipped after the fact. Audio
// stays encoded until a clip or a live monitor needs it. The session voice
// channel is deleted the moment the host leaves, so a destroyed connection is
// the normal shutdown path, never an error to retry.

const {
    joinVoiceChannel, entersState, VoiceConnectionStatus, EndBehaviorType,
} = require('@discordjs/voice');
const { OpusEncoder } = require('@discordjs/opus');
const { ContainerBuilder, MessageFlags } = require('discord.js');
const logger = require('../logger');
const { buildTextBlock } = require('../ui');
const { createStore, recordPacket, createPacer, paceTimestamp } = require('./buffers');
const { getReadyWorkers } = require('./worker_pool');
const { VOICE_BUFFER_MINUTES } = require('../../config/constants');

// channelId -> { connection, store, session, subscriptions: Set<userId>,
//                decoders: Map<userId, OpusEncoder>, tap: fn|null, guildId,
//                client, isMainClient }
const captures = new Map();

const getCaptureState = (channelId) => captures.get(channelId) || null;

// The channel whose capture rides on the MAIN bot user, if any. Worker
// captures never constrain TTS -- the main bot can join a channel alongside a
// worker -- so only the capture sharing the main bot's voice slot is reported.
const getGuildCaptureChannel = (guildId) => {
    for (const [channelId, state] of captures) {
        if (state.guildId === guildId && state.isMainClient) return channelId;
    }
    return null;
};

// One bot user holds one voice state per guild, so parallel sessions need
// parallel bot users. Workers take captures first, keeping the main bot's
// slot free for TTS; the main bot is the fallback when every worker is taken.
// workersOnly (public rooms) never touches the main bot's slot.
const pickCaptureClient = ({ mainClient, workers, guildId, busyUserIds, workersOnly = false }) => {
    const free = (candidate) => candidate.isReady() && !busyUserIds.has(candidate.user.id);
    return workers.find((worker) => free(worker) && worker.guilds.cache.has(guildId))
        || (!workersOnly && free(mainClient) ? mainClient : null);
};

const countFreeWorkers = ({ workers, guildId, busyUserIds }) => workers.filter((worker) =>
    worker.isReady() && !busyUserIds.has(worker.user.id) && worker.guilds.cache.has(guildId)).length;

const freeWorkerCountIn = (guildId) =>
    countFreeWorkers({ workers: getReadyWorkers(), guildId, busyUserIds: busyUserIdsIn(guildId) });

const busyUserIdsIn = (guildId) => {
    const busy = new Set();
    for (const state of captures.values()) {
        if (state.guildId === guildId) busy.add(state.client.user.id);
    }
    return busy;
};

const setTap = (channelId, fn) => {
    const state = captures.get(channelId);
    if (!state) return false;
    state.tap = fn;
    return true;
};

const clearTap = (channelId) => {
    const state = captures.get(channelId);
    if (state) state.tap = null;
};

const decoderFor = (state, userId) => {
    let decoder = state.decoders.get(userId);
    if (!decoder) {
        decoder = new OpusEncoder(48000, 2);
        state.decoders.set(userId, decoder);
    }
    return decoder;
};

const stereoToMono = (pcm) => {
    const frames = Math.floor(pcm.length / 4);
    const mono = Buffer.alloc(frames * 2);
    for (let i = 0; i < frames; i += 1) {
        const left = pcm.readInt16LE(i * 4);
        const right = pcm.readInt16LE(i * 4 + 2);
        mono.writeInt16LE(Math.round((left + right) / 2), i * 2);
    }
    return mono;
};

const subscribeToUser = (state, userId) => {
    if (state.subscriptions.has(userId)) return;
    state.subscriptions.add(userId);
    const stream = state.connection.receiver.subscribe(userId, {
        end: { behavior: EndBehaviorType.AfterSilence, duration: 1000 },
    });
    const pacer = createPacer();
    stream.on('data', (packet) => {
        recordPacket(state.store, userId, packet, paceTimestamp(pacer, Date.now()));
        if (state.tap) {
            try {
                state.tap(userId, stereoToMono(decoderFor(state, userId).decode(packet)));
            } catch (error) {
                logger.error(`[Voice Mod] Tap failed for user ${userId}:`, error);
            }
        }
    });
    const release = () => state.subscriptions.delete(userId);
    stream.on('end', release);
    stream.on('error', (error) => {
        logger.error(`[Voice Mod] Receive stream error for user ${userId}:`, error);
        release();
    });
};

// Consent is a hard gate, not a courtesy: if the room cannot be told it is
// being buffered, nothing may be buffered. Returns whether the notice landed.
const postConsentNotice = async (channel, {
    subtitle = 'EMH Event Session',
    lines = [
        'Audio in this event is temporarily buffered for moderation while the session runs.',
        'Nothing is stored unless staff capture an incident clip; the buffer is discarded when the event ends.',
    ],
} = {}) => {
    const container = new ContainerBuilder().setAccentColor(0xF59E0B);
    const block = buildTextBlock({
        title: 'Voice Moderation Active',
        subtitle,
        lines,
    });
    if (block) container.addTextDisplayComponents(block);
    try {
        await channel.send({ flags: MessageFlags.IsComponentsV2, components: [container] });
        return true;
    } catch (error) {
        logger.error(`[Voice Mod] Could not post consent notice in ${channel.id}:`, error);
        return false;
    }
};

const joinSession = async ({ channel, session, workersOnly = false, notice }) => {
    if (captures.has(channel.id)) return;
    const guildId = channel.guild.id;
    const mainClient = channel.client;
    const workers = getReadyWorkers();
    const botClient = pickCaptureClient({
        mainClient, workers, guildId, busyUserIds: busyUserIdsIn(guildId), workersOnly,
    });
    if (!botClient) {
        // ponytail: capacity is 1 + workers-in-guild parallel sessions; add a
        // handoff queue only if guilds ever run more sessions than that.
        logger.warn(`[Voice Mod] Session ${session.id} in ${channel.id} is not captured: all capture bots (main + ${workers.length} workers) are busy in guild ${guildId}.`);
        return;
    }
    try {
        const connection = joinVoiceChannel({
            channelId: channel.id,
            guildId,
            // @discordjs/voice keys connections by (group, guildId) and the
            // default group is shared: without a per-client group a second
            // worker's join MOVES the first worker's connection to the new
            // channel instead of opening its own.
            group: botClient.user.id,
            adapterCreator: botClient.guilds.cache.get(guildId).voiceAdapterCreator,
            selfMute: true,
            selfDeaf: false,
        });
        const state = {
            connection,
            store: createStore({ windowMs: VOICE_BUFFER_MINUTES * 60 * 1000 }),
            session,
            subscriptions: new Set(),
            decoders: new Map(),
            tap: null,
            guildId,
            client: botClient,
            isMainClient: botClient === mainClient,
        };
        captures.set(channel.id, state);

        connection.on(VoiceConnectionStatus.Disconnected, async () => {
            // A deleted channel (session over) destroys the connection; a network
            // blip re-signals within five seconds. Only the blip is worth waiting on.
            try {
                await Promise.race([
                    entersState(connection, VoiceConnectionStatus.Signalling, 5000),
                    entersState(connection, VoiceConnectionStatus.Connecting, 5000),
                ]);
            } catch {
                leaveSession(channel.id);
            }
        });
        connection.on('error', (error) => {
            logger.error(`[Voice Mod] Connection error in ${channel.id}:`, error);
        });

        await entersState(connection, VoiceConnectionStatus.Ready, 15000);
        if (!(await postConsentNotice(channel, notice))) {
            leaveSession(channel.id);
            return;
        }
        // Reception starts only after the room has been told about it.
        connection.receiver.speaking.on('start', (userId) => {
            try {
                subscribeToUser(state, userId);
            } catch (error) {
                logger.error(`[Voice Mod] Failed to subscribe to ${userId} in ${channel.id}:`, error);
            }
        });
        logger.info(`[Voice Mod] Capturing session ${session.id} in channel ${channel.id} via ${state.isMainClient ? 'main bot' : botClient.user.tag}.`);
    } catch (error) {
        leaveSession(channel.id);
        throw error;
    }
};

const leaveSession = (channelId) => {
    const state = captures.get(channelId);
    if (!state) return;
    captures.delete(channelId);
    try {
        state.connection.destroy();
    } catch {
        // Already destroyed by the channel deletion; nothing to release.
    }
    logger.info(`[Voice Mod] Stopped capturing channel ${channelId}; buffers discarded.`);
};

module.exports = {
    joinSession, leaveSession, getCaptureState, getGuildCaptureChannel,
    pickCaptureClient, countFreeWorkers, freeWorkerCountIn, setTap, clearTap,
};
