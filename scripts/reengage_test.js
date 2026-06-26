'use strict';

// One-off re-engagement test runner.
//
// Sends a single re-engagement DM to the allowlisted test user (forced target,
// real stats, simulated lapse) and then stays online for a short window so the
// SAME process can handle the button / survey interactions, giving an end-to-end
// test without running the full bot.
//
// Safety: the recipient allowlist and force list default to the single test user
// and the allowlist hard-gates every send, so this cannot fan out.
//
// Usage:
//   node scripts/reengage_test.js [userId]
//   REENGAGE_TEST_KEEPALIVE_MS=600000 node scripts/reengage_test.js

require('dotenv').config({ path: './resources/.env' });

const TEST_USER = process.argv[2] || process.env.REENGAGE_TEST_USER || '781397829808553994';

// Default the gates to the single test user unless already set in the environment.
process.env.REENGAGE_ALLOWLIST = process.env.REENGAGE_ALLOWLIST || TEST_USER;
process.env.REENGAGE_FORCE_USER_IDS = process.env.REENGAGE_FORCE_USER_IDS || TEST_USER;

const { Client, GatewayIntentBits, Partials } = require('discord.js');
const logger = require('../utils/logger');
const { isReengagementInteraction, handleReengagementInteraction } = require('../handlers/reengagement');
const { ensureReengagementTables } = require('../db');
const { runReengagementSweep } = require('../jobs/reengagement');

const KEEPALIVE_MS = Number(process.env.REENGAGE_TEST_KEEPALIVE_MS || 600000);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel, Partials.Message],
});

// This standalone harness only owns re-engagement interactions. It deliberately
// ignores everything else (commands, other components) so it neither needs the
// full bot's command registry nor competes with a running production bot.
client.on('interactionCreate', async (interaction) => {
    if (!isReengagementInteraction(interaction.customId)) {
        return;
    }
    try {
        await handleReengagementInteraction(interaction, client);
    } catch (error) {
        logger.error(`[ReengageTest] Interaction error: ${error.message}`);
    }
});

client.once('clientReady', async () => {
    logger.info(`[ReengageTest] Logged in as ${client.user.tag}.`);
    logger.info(`[ReengageTest] Allowlist: ${process.env.REENGAGE_ALLOWLIST}`);
    logger.info(`[ReengageTest] Force targets: ${process.env.REENGAGE_FORCE_USER_IDS}`);

    try {
        await ensureReengagementTables();
        const summaries = await runReengagementSweep(client, { force: true });
        logger.info(`[ReengageTest] Sweep summary: ${JSON.stringify(summaries)}`);
    } catch (error) {
        logger.error(`[ReengageTest] Sweep failed: ${error.message}`);
        await client.destroy();
        process.exit(1);
    }

    logger.info(`[ReengageTest] Staying online ${Math.round(KEEPALIVE_MS / 1000)}s to handle button/survey clicks. Ctrl+C to quit early.`);
    setTimeout(async () => {
        logger.info('[ReengageTest] Keepalive elapsed, shutting down.');
        await client.destroy();
        process.exit(0);
    }, KEEPALIVE_MS);
});

const token = process.env.TOKEN;
if (!token) {
    logger.error('[ReengageTest] Missing TOKEN in resources/.env');
    process.exit(1);
}
client.login(token);
