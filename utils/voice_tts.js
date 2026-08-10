'use strict';

// Piper text-to-speech into a voice channel. Piper runs locally on the host
// (PIPER_BIN + PIPER_MODEL env vars), so speaking costs nothing per use. If a
// moderation capture holds the target channel, its connection is borrowed:
// unmute, speak, re-mute, capture never stops. A capture in a different
// channel wins outright; the bot has one voice slot per guild and an event
// being recorded outranks a TTS announcement.

const { spawn } = require('child_process');
const { Readable } = require('stream');
const {
    joinVoiceChannel, entersState, VoiceConnectionStatus,
    createAudioPlayer, createAudioResource, StreamType, AudioPlayerStatus,
} = require('@discordjs/voice');
const logger = require('./logger');
const { resampleMonoPcm, wavToMonoPcm } = require('./voice_moderation/wav');
const { getCaptureState, getGuildCaptureChannel } = require('./voice_moderation/capture');

const speakingGuilds = new Set();

const isConfigured = () => Boolean(process.env.PIPER_BIN && process.env.PIPER_MODEL);

// Runs piper with the text on stdin; WAV arrives on stdout (piper's default
// when no output file is given).
const synthesize = (text) => new Promise((resolve, reject) => {
    const args = [
        '-m', process.env.PIPER_MODEL,
        ...(process.env.PIPER_DATA_DIR ? ['--data-dir', process.env.PIPER_DATA_DIR] : []),
    ];
    const child = spawn(process.env.PIPER_BIN, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = [];
    const errors = [];
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => errors.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
        if (code !== 0) {
            reject(new Error(`piper exited ${code}: ${Buffer.concat(errors).toString().slice(-300)}`));
        } else {
            resolve(Buffer.concat(chunks));
        }
    });
    child.stdin.end(text);
});

const monoToStereo48k = (wav) => {
    const parsed = wavToMonoPcm(wav);
    if (!parsed) return null;
    const mono = resampleMonoPcm(parsed.pcm, parsed.sampleRate, 48000);
    const stereo = Buffer.alloc(mono.length * 2);
    for (let i = 0; i < mono.length; i += 2) {
        const sample = mono.readInt16LE(i);
        stereo.writeInt16LE(sample, i * 2);
        stereo.writeInt16LE(sample, i * 2 + 2);
    }
    return stereo;
};

const remute = (connection) => {
    try {
        connection.rejoin({
            channelId: connection.joinConfig.channelId,
            selfDeaf: connection.joinConfig.selfDeaf,
            selfMute: true,
        });
    } catch (error) {
        logger.error('[TTS] Failed to re-mute capture connection:', error);
    }
};

// Speaks text in the given voice channel. Returns { ok } or { ok: false,
// reason: 'unconfigured' | 'busy' | 'capturing-elsewhere' | 'failed' }.
const speak = async ({ channel, text }) => {
    if (!isConfigured()) return { ok: false, reason: 'unconfigured' };
    const guildId = channel.guild.id;
    if (speakingGuilds.has(guildId)) return { ok: false, reason: 'busy' };
    const captureChannelId = getGuildCaptureChannel(guildId);
    if (captureChannelId && captureChannelId !== channel.id) {
        return { ok: false, reason: 'capturing-elsewhere' };
    }

    speakingGuilds.add(guildId);
    const borrowed = captureChannelId === channel.id;
    let connection = null;
    try {
        const stereo = monoToStereo48k(await synthesize(text));
        if (!stereo) throw new Error('piper produced no usable audio');

        if (borrowed) {
            connection = getCaptureState(channel.id).connection;
            connection.rejoin({
                channelId: channel.id,
                selfDeaf: connection.joinConfig.selfDeaf,
                selfMute: false,
            });
        } else {
            connection = joinVoiceChannel({
                channelId: channel.id,
                guildId,
                adapterCreator: channel.guild.voiceAdapterCreator,
                selfMute: false,
                selfDeaf: true,
            });
        }
        await entersState(connection, VoiceConnectionStatus.Ready, 15000);

        const player = createAudioPlayer();
        const subscription = connection.subscribe(player);
        player.play(createAudioResource(Readable.from([stereo]), { inputType: StreamType.Raw }));
        await entersState(player, AudioPlayerStatus.Playing, 5000);
        await entersState(player, AudioPlayerStatus.Idle, 60000);
        player.stop();
        subscription?.unsubscribe();
        return { ok: true };
    } catch (error) {
        logger.error('[TTS] Failed to speak:', error);
        return { ok: false, reason: 'failed' };
    } finally {
        if (connection) {
            if (borrowed) remute(connection);
            else {
                try {
                    connection.destroy();
                } catch {
                    // Already gone.
                }
            }
        }
        speakingGuilds.delete(guildId);
    }
};

module.exports = { speak, isConfigured };
