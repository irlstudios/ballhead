'use strict';

require('dotenv').config({ path: './resources/.env' });
const { Client, GatewayIntentBits } = require('discord.js');
const logger = require('../utils/logger');
const { ensurePollTables } = require('../db');
const { indexThread } = require('../handlers/poll_tracker');
const { GAME_IDEAS_FORUM_CHANNEL_ID, BUG_REPORTS_FORUM_CHANNEL_ID } = require('../config/constants');

// ponytail: fetchArchived returns only the most recent ~100 archived threads per
// forum (no pagination here). Good enough for launch; add hasMore paging if a forum
// has more archived posts than that and older posts must be pollable.
const backfillForum = async (client, forumId) => {
    const forum = await client.channels.fetch(forumId).catch(() => null);
    if (!forum || typeof forum.threads?.fetchActive !== 'function') {
        logger.error(`[PollBackfill] Forum ${forumId} not found or not a forum`);
        return 0;
    }
    const active = [...(await forum.threads.fetchActive()).threads.values()];
    const archived = [...(await forum.threads.fetchArchived()).threads.values()];
    const all = [...active, ...archived];
    for (const thread of all) {
        await indexThread(thread);
    }
    return all.length;
};

(async () => {
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    try {
        await client.login(process.env.TOKEN);
        await ensurePollTables();
        const ideas = await backfillForum(client, GAME_IDEAS_FORUM_CHANNEL_ID);
        const bugs = await backfillForum(client, BUG_REPORTS_FORUM_CHANNEL_ID);
        logger.info(`[PollBackfill] Indexed ${ideas} game-idea thread(s) and ${bugs} bug thread(s)`);
    } catch (error) {
        logger.error('[PollBackfill] Failed:', error);
    } finally {
        await client.destroy();
        process.exit(0);
    }
})();
