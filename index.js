const { Client, Collection, GatewayIntentBits, Partials } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: './resources/.env' });
const logger = require('./utils/logger');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildEmojisAndStickers,
        GatewayIntentBits.GuildIntegrations,
        GatewayIntentBits.GuildWebhooks,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMessageTyping,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.DirectMessageReactions,
        GatewayIntentBits.DirectMessageTyping,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildScheduledEvents,
        GatewayIntentBits.GuildBans
    ],
    partials: [Partials.Message, Partials.Reaction, Partials.Channel]
});

client.commands = new Collection();
client.cooldowns = new Collection();

const getCommandFiles = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries.flatMap((entry) => {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            return getCommandFiles(entryPath);
        }
        return entry.isFile() && entry.name.endsWith('.js') ? [entryPath] : [];
    });
};

try {
    const commandFiles = getCommandFiles(path.join(__dirname, 'commands'));
    for (const file of commandFiles) {
        try {
            const command = require(file);
            if (!command?.data?.name) {
                logger.error(`Error loading ${file}: 'data' or 'name' property is missing or invalid.`);
                continue;
            }
            logger.info(`Registering Command: ${command.data.name}`);
            client.commands.set(command.data.name, command);
        } catch (error) {
            logger.error(`Error loading ${file}: ${error}`);
        }
    }
} catch (error) {
    logger.error('Error reading command files:', error);
}

try {
    const eventFiles = fs.readdirSync('./events').filter(file => file.endsWith('.js'));
    for (const file of eventFiles) {
        const event = require(`./events/${file}`);
        if (!event.name || !event.execute) {
            logger.error(`Error loading ${file}: Event does not properly export 'name' or 'execute'.`);
            continue;
        }
        const safeExecute = async (...args) => {
            try {
                await event.execute(...args, client);
            } catch (err) {
                logger.error(`[Event] Unhandled error in ${event.name}:`, err);
            }
        };
        if (event.once) {
            client.once(event.name, safeExecute);
        } else {
            client.on(event.name, safeExecute);
        }
    }
} catch (error) {
    logger.error('Error reading event files:', error);
}

const interactionHandler = require('./interactionHandler');
client.on('interactionCreate', async (interaction) => {
    try {
        await interactionHandler(interaction, client);
    } catch (error) {
        logger.error('Error handling interaction:', error);
    }
});

const token = process.env.TOKEN;
if (!token) {
    logger.error('Bot token is missing. Please add your bot token to the .env file.');
    process.exit(1);
}

const { startCacheWarmer } = require('./utils/cache_warmer');
const { ensureLfgTable } = require('./db');

client.login(token).then(async () => {
    logger.info('Bot logged in successfully.');

    // Run DB migrations
    try {
        await ensureLfgTable();
        logger.info('[DB] LFG table ensured.');
    } catch (error) {
        logger.error('[DB] Failed to ensure LFG table:', error);
    }

    // Start cache warming system
    startCacheWarmer().catch(error => {
        logger.error('[Cache Warmer] Error starting cache warmer:', error);
    });
}).catch(error => {
    logger.error('Failed to login:', error);
    process.exit(1);
});

// Graceful shutdown handling
const { closePool } = require('./db');
const { stopCacheWarmer } = require('./utils/cache_warmer');
const { stopCacheMaintenance } = require('./utils/sheets_cache');

async function gracefulShutdown(signal) {
    logger.info(`\n[Shutdown] Received ${signal}. Starting graceful shutdown...`);

    try {
        // Stop accepting new interactions
        client.destroy();
        logger.info('[Shutdown] Discord client destroyed');

        // Stop cache warming
        stopCacheWarmer();

        // Stop cache maintenance
        stopCacheMaintenance();

        // Close database pool
        await closePool();

        logger.info('[Shutdown] Graceful shutdown complete');
        process.exit(0);
    } catch (error) {
        logger.error('[Shutdown] Error during graceful shutdown:', error);
        process.exit(1);
    }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
