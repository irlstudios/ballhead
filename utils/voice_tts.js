'use strict';

// Piper text-to-speech into a voice channel. Piper runs locally on the host
// (PIPER_BIN + PIPER_MODEL env vars), so speaking costs nothing per use.

const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { ChannelType } = require('discord.js');
const {
    joinVoiceChannel, entersState, VoiceConnectionStatus,
    createAudioPlayer, createAudioResource, StreamType, AudioPlayerStatus,
} = require('@discordjs/voice');
const logger = require('./logger');
const { resampleMonoPcm, wavToMonoPcm } = require('./wav');

const speakingGuilds = new Set();

const isConfigured = () => Boolean(process.env.PIPER_BIN && process.env.PIPER_MODEL);

// Runs piper with the text on stdin. Piper's stdout mode is unreliable
// across builds (some emit nothing without -f), so it writes a temp WAV
// which is read back and removed.
const synthesize = async (text) => {
    const outPath = path.join(os.tmpdir(), `ballhead-tts-${randomUUID()}.wav`);
    try {
        await new Promise((resolve, reject) => {
            const args = [
                '-m', process.env.PIPER_MODEL,
                ...(process.env.PIPER_DATA_DIR ? ['--data-dir', process.env.PIPER_DATA_DIR] : []),
                '-f', outPath,
            ];
            const child = spawn(process.env.PIPER_BIN, args, { stdio: ['pipe', 'ignore', 'pipe'] });
            const errors = [];
            child.stderr.on('data', (chunk) => errors.push(chunk));
            child.on('error', reject);
            child.on('close', (code) => {
                if (code !== 0) {
                    reject(new Error(`piper exited ${code}: ${Buffer.concat(errors).toString().slice(-300)}`));
                } else {
                    resolve();
                }
            });
            child.stdin.end(text);
        });
        return fs.readFileSync(outPath);
    } finally {
        fs.rmSync(outPath, { force: true });
    }
};

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

// Speaks text in the given voice channel. Returns { ok } or { ok: false,
// reason: 'unconfigured' | 'busy' | 'stage-suppressed' | 'failed' }.
const speak = async ({ channel, text }) => {
    if (!isConfigured()) return { ok: false, reason: 'unconfigured' };
    const guildId = channel.guild.id;
    if (speakingGuilds.has(guildId)) return { ok: false, reason: 'busy' };

    speakingGuilds.add(guildId);
    let connection = null;
    try {
        const stereo = monoToStereo48k(await synthesize(text));
        if (!stereo) throw new Error('piper produced no usable audio');

        connection = joinVoiceChannel({
            channelId: channel.id,
            guildId,
            adapterCreator: channel.guild.voiceAdapterCreator,
            selfMute: false,
            selfDeaf: true,
        });
        await entersState(connection, VoiceConnectionStatus.Ready, 15000);

        // Stages admit the bot as audience; it must become a speaker to be
        // heard. Needs Mute Members on the stage channel.
        if (channel.type === ChannelType.GuildStageVoice) {
            try {
                await channel.guild.members.me.voice.setSuppressed(false);
            } catch (error) {
                logger.error('[TTS] Could not become a stage speaker:', error);
                return { ok: false, reason: 'stage-suppressed' };
            }
        }

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
            try {
                connection.destroy();
            } catch {
                // Already gone.
            }
        }
        speakingGuilds.delete(guildId);
    }
};

module.exports = { speak, isConfigured };
