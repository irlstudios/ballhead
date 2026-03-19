const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const logger = require('../utils/logger');
const { executeQuery, fetchExpiredPendingInvites, deleteInvite, ensureInvitesSchema } = require('../db');
require('dotenv').config({ path: './resources/.env' });

const processExpiredRoleTimeouts = async (client) => {
    try {
        const result = await executeQuery(
            'SELECT user_id, role_id, guild_id FROM role_timeouts WHERE expires_at <= NOW()'
        ).catch(() => null);
        if (!result || result.rows.length === 0) return;

        for (const row of result.rows) {
            try {
                const guild = await client.guilds.fetch(row.guild_id).catch(() => null);
                if (!guild) continue;
                const member = await guild.members.fetch(row.user_id).catch(() => null);
                if (member) {
                    await member.roles.remove(row.role_id).catch(() => null);
                    logger.info(`[Startup] Removed expired role ${row.role_id} from ${member.user.tag}`);
                }
                await executeQuery(
                    'DELETE FROM role_timeouts WHERE user_id = $1 AND role_id = $2',
                    [row.user_id, row.role_id]
                );
            } catch (err) {
                logger.error(`[Startup] Failed to process expired role timeout for ${row.user_id}:`, err);
            }
        }
    } catch (error) {
        logger.error('[Startup] Error processing expired role timeouts:', error);
    }
};

const scheduleFutureRoleTimeouts = async (client) => {
    try {
        const result = await executeQuery(
            'SELECT user_id, role_id, guild_id, expires_at FROM role_timeouts WHERE expires_at > NOW()'
        ).catch(() => null);
        if (!result || result.rows.length === 0) return;

        for (const row of result.rows) {
            const delay = new Date(row.expires_at).getTime() - Date.now();
            if (delay <= 0) continue;
            setTimeout(async () => {
                try {
                    // Re-check DB in case expiry was extended
                    const checkResult = await executeQuery(
                        'SELECT expires_at FROM role_timeouts WHERE user_id = $1 AND role_id = $2',
                        [row.user_id, row.role_id]
                    );
                    const current = checkResult.rows[0];
                    if (current && new Date(current.expires_at) > new Date()) {
                        return; // Was extended, skip
                    }
                    const guild = await client.guilds.fetch(row.guild_id).catch(() => null);
                    if (!guild) return;
                    const member = await guild.members.fetch(row.user_id).catch(() => null);
                    if (member) {
                        await member.roles.remove(row.role_id).catch(() => null);
                        logger.info(`[Scheduled] Removed expired role ${row.role_id} from ${member.user.tag}`);
                    }
                    await executeQuery(
                        'DELETE FROM role_timeouts WHERE user_id = $1 AND role_id = $2',
                        [row.user_id, row.role_id]
                    );
                } catch (err) {
                    logger.error(`[Scheduled] Failed to process role timeout for ${row.user_id}:`, err);
                }
            }, delay);
        }
        logger.info(`[Startup] Scheduled ${result.rows.length} future role timeout(s)`);
    } catch (error) {
        logger.error('[Startup] Error scheduling future role timeouts:', error);
    }
};

const processExpiredInvites = async (client) => {
    try {
        await ensureInvitesSchema();
        const expired = await fetchExpiredPendingInvites();
        for (const invite of expired) {
            try {
                await deleteInvite(invite.message_id);
                logger.info(`[Startup] Cleaned expired invite ${invite.message_id}`);
            } catch (err) {
                logger.error(`[Startup] Failed to clean expired invite ${invite.message_id}:`, err);
            }
        }
        if (expired.length > 0) {
            logger.info(`[Startup] Cleaned ${expired.length} expired invite(s)`);
        }
    } catch (error) {
        logger.error('[Startup] Error processing expired invites:', error);
    }
};

module.exports = {
    name: 'clientReady',
    once: true,
    async execute(client) {
        logger.info(`Logged in as ${client.user.tag}!`);

        const commands = client.commands.map(cmd => cmd.data.toJSON());
        const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

        try {
            await rest.put(
                Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
                { body: commands }
            );
            logger.info('Successfully registered application commands and refreshed!');
        } catch (error) {
            logger.error('Failed to register commands:', error);
        }

        await processExpiredRoleTimeouts(client);
        await scheduleFutureRoleTimeouts(client);
        await processExpiredInvites(client);
    },
};