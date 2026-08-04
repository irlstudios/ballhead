'use strict';

const logger = require('../utils/logger');
const { MOD_PING_ROLES } = require('../config/constants');
const { getModPingSubscribers } = require('../utils/mod_ping_queries');
const { resolveModPingDmTargets } = require('../utils/mod_ping_logic');

const MOD_PING_ROLE_IDS = new Set(MOD_PING_ROLES.map(({ id }) => id));

// DMs subscribed mods when one of the rolling mod roles is pinged, so an
// active mod without the pinged role still sees it. Skips subscribers who hold
// the pinged role (Discord already notified them) and the message author.
module.exports = {
    name: 'messageCreate',
    once: false,
    async execute(message) {
        try {
            if (message.author?.bot || !message.guild) {
                return;
            }
            const pingedRoleIds = [...message.mentions.roles.keys()]
                .filter((id) => MOD_PING_ROLE_IDS.has(id));
            if (pingedRoleIds.length === 0) {
                return;
            }

            const subscriptions = await getModPingSubscribers(pingedRoleIds);
            if (subscriptions.length === 0) {
                return;
            }

            const userIds = [...new Set(subscriptions.map((row) => row.user_id))];
            const members = await message.guild.members
                .fetch({ user: userIds })
                .catch(() => new Map());
            const heldRoleIdsByUserId = new Map(
                [...members.values()].map((member) => [member.id, new Set(member.roles.cache.keys())])
            );

            const targets = resolveModPingDmTargets({
                pingedRoleIds,
                subscriptions,
                authorId: message.author.id,
                heldRoleIdsByUserId,
            });

            for (const [userId, roleIds] of targets) {
                const member = members.get(userId);
                if (!member) {
                    continue;
                }
                const lines = roleIds.map((roleId) => {
                    const roleName = message.guild.roles.cache.get(roleId)?.name
                        ?? MOD_PING_ROLES.find((role) => role.id === roleId)?.name
                        ?? roleId;
                    return `**${roleName}** was pinged in **#${message.channel.name}**`;
                });
                await member
                    .send(`${lines.join('\n')}\n${message.url}`)
                    .catch((error) => logger.error(`[ModPings] Failed to DM ${userId}:`, error));
            }
        } catch (error) {
            logger.error('[ModPings] Listener failed:', error);
        }
    },
};
