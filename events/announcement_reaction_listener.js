'use strict';

const { Events } = require('discord.js');
const logger = require('../utils/logger');
const { executeQuery } = require('../db');

const ROLE_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const MESSAGE_AGE_LIMIT_MS = 7 * 24 * 60 * 60 * 1000;
const CHANNEL_IDS = ['764593469746315286', '807765316813324319'];
const ROLE_ID = '1284910121004040404';

const ensureRoleTimeoutsTable = async () => {
    await executeQuery(`CREATE TABLE IF NOT EXISTS role_timeouts (
        user_id TEXT NOT NULL,
        role_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (user_id, role_id)
    )`);
};

let tableReady = null;

module.exports = {
    name: Events.MessageReactionAdd,
    async execute(reaction, user, client) {
        if (user.bot) return;
        if (!CHANNEL_IDS.includes(reaction.message.channel.id)) return;

        const messageTimestamp = reaction.message.createdTimestamp;
        if (Date.now() - messageTimestamp > MESSAGE_AGE_LIMIT_MS) {
            logger.info(`Reaction ignored for old message (over 7 days): ${reaction.message.id}`);
            return;
        }

        const guild = reaction.message.guild;
        const member = await guild.members.fetch(user.id);
        const role = guild.roles.cache.get(ROLE_ID);
        if (!role) {
            logger.error(`Role with ID ${ROLE_ID} not found.`);
            return;
        }

        try {
            if (!tableReady) {
                tableReady = ensureRoleTimeoutsTable();
            }
            await tableReady;

            await member.roles.add(role);
            logger.info(`Role ${role.name} assigned to ${member.user.tag} for reacting to a recent message.`);

            const expiresAt = new Date(Date.now() + ROLE_TIMEOUT_MS);
            await executeQuery(
                `INSERT INTO role_timeouts (user_id, role_id, guild_id, expires_at)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (user_id, role_id) DO UPDATE SET expires_at = $4`,
                [member.user.id, ROLE_ID, guild.id, expiresAt]
            );

            setTimeout(async () => {
                try {
                    // Check DB to see if expiry was extended by a newer reaction
                    const checkResult = await executeQuery(
                        'SELECT expires_at FROM role_timeouts WHERE user_id = $1 AND role_id = $2',
                        [member.user.id, ROLE_ID]
                    );
                    const row = checkResult.rows[0];
                    if (row && new Date(row.expires_at) > new Date()) {
                        // Expiry was extended, skip removal
                        return;
                    }

                    const freshMember = await guild.members.fetch(member.user.id).catch(() => null);
                    if (freshMember) {
                        await freshMember.roles.remove(role);
                        logger.info(`Role ${role.name} removed from ${member.user.tag} after timeout.`);
                    }
                    await executeQuery(
                        'DELETE FROM role_timeouts WHERE user_id = $1 AND role_id = $2',
                        [member.user.id, ROLE_ID]
                    );
                } catch (error) {
                    logger.error(`Failed to remove role ${role.name} from ${member.user.tag}:`, error);
                }
            }, ROLE_TIMEOUT_MS);
        } catch (error) {
            logger.error(`Failed to assign role ${role.name} to ${member.user.tag}:`, error);
        }
    }
};
