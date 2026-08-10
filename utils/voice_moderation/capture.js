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
const { VOICE_BUFFER_MINUTES } = require('../../config/constants');

// channelId -> { connection, store, session, subscriptions: Set<userId>,
//                decoders: Map<userId, OpusEncoder>, tap: fn|null, guildId }
const captures = new Map();

// One bot user holds one voice state per guild, so a second concurrent EMH
// session in the same guild cannot be captured: joining it would silently rip
// the connection out of the first room and cross-wire the receivers.
// guildId -> channelId of the session currently holding the capture slot.
const captureSlotByGuild = new Map();

const getCaptureState = (channelId) => captures.get(channelId) || null;

// Which channel currently holds the guild's single voice slot, if any.
const getGuildCaptureChannel = (guildId) => captureSlotByGuild.get(guildId) || null;

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
const postConsentNotice = async (channel) => {
    const container = new ContainerBuilder().setAccentColor(0xF59E0B);
    const block = buildTextBlock({
        title: 'Voice Moderation Active',
        subtitle: 'EMH Event Session',
        lines: [
            'Audio in this event is temporarily buffered for moderation while the session runs.',
            'Nothing is stored unless staff capture an incident clip; the buffer is discarded when the event ends.',
        ],
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

const joinSession = async ({ channel, session }) => {
    if (captures.has(channel.id)) return;
    const guildId = channel.guild.id;
    const holder = captureSlotByGuild.get(guildId);
    if (holder) {
        logger.warn(`[Voice Mod] Session ${session.id} in ${channel.id} is not captured: the guild's capture slot is held by channel ${holder}.`);
        return;
    }
    captureSlotByGuild.set(guildId, channel.id);
    try {
        const connection = joinVoiceChannel({
            channelId: channel.id,
            guildId,
            adapterCreator: channel.guild.voiceAdapterCreator,
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
        if (!(await postConsentNotice(channel))) {
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
        logger.info(`[Voice Mod] Capturing session ${session.id} in channel ${channel.id}.`);
    } catch (error) {
        leaveSession(channel.id);
        captureSlotByGuild.delete(guildId);
        throw error;
    }
};

const leaveSession = (channelId) => {
    const state = captures.get(channelId);
    if (!state) return;
    captures.delete(channelId);
    if (captureSlotByGuild.get(state.guildId) === channelId) {
        captureSlotByGuild.delete(state.guildId);
    }
    try {
        state.connection.destroy();
    } catch {
        // Already destroyed by the channel deletion; nothing to release.
    }
    logger.info(`[Voice Mod] Stopped capturing channel ${channelId}; buffers discarded.`);
};

module.exports = { joinSession, leaveSession, getCaptureState, getGuildCaptureChannel, setTap, clearTap };
