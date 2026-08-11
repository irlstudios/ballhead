'use strict';

// Extra bot users that carry voice captures. One bot user holds one voice
// connection per guild, so parallel EMH sessions need parallel bot users:
// each worker is a separate Discord application (invited to the guild with
// Connect/View Channel) whose only job is sitting in a session channel
// receiving audio. Tokens come from BALLHEAD_WORKER_TOKEN_1, _2, ... env vars.

const { Client, GatewayIntentBits } = require('discord.js');
const logger = require('../logger');

const workers = [];

const workerTokens = () => Object.keys(process.env)
    .filter((key) => /^BALLHEAD_WORKER_TOKEN_\d+$/.test(key))
    .sort((a, b) => Number(a.split('_').pop()) - Number(b.split('_').pop()))
    .map((key) => process.env[key].trim())
    .filter(Boolean);

const startWorkers = async () => {
    const tokens = workerTokens();
    if (!tokens.length) {
        logger.info('[Voice Mod] No capture workers configured; the main bot carries the single capture slot.');
        return;
    }
    await Promise.all(tokens.map(async (token, index) => {
        const worker = new Client({
            intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
        });
        worker.once('clientReady', (ready) => {
            logger.info(`[Voice Mod] Capture worker ${index + 1} online as ${ready.user.tag}.`);
        });
        try {
            await worker.login(token);
            workers.push(worker);
        } catch (error) {
            logger.error(`[Voice Mod] Capture worker ${index + 1} failed to log in:`, error);
            worker.destroy();
        }
    }));
    logger.info(`[Voice Mod] ${workers.length}/${tokens.length} capture workers logged in.`);
};

const getReadyWorkers = () => workers.filter((worker) => worker.isReady());

const stopWorkers = () => {
    for (const worker of workers) {
        try {
            worker.destroy();
        } catch {
            // Already gone.
        }
    }
};

module.exports = { startWorkers, getReadyWorkers, stopWorkers };
