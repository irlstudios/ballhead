'use strict';

require('dotenv').config({ path: './resources/.env' });
const { Client, GatewayIntentBits } = require('discord.js');
const logger = require('../utils/logger');
const { ensurePollTables } = require('../db');
const { backfillAllForums } = require('../utils/poll_backfill');

// Manual one-time (or on-demand) full re-sync of the poll catalog. The bot also
// runs this automatically on startup when the catalog is empty, so this script is
// only needed for a forced full re-index.
(async () => {
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    try {
        await client.login(process.env.TOKEN);
        await ensurePollTables();
        await backfillAllForums(client);
    } catch (error) {
        logger.error('[PollBackfill] Failed:', error);
    } finally {
        await client.destroy();
        process.exit(0);
    }
})();
