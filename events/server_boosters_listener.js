const { Events } = require('discord.js');
const logger = require('../utils/logger');
const { GYM_CLASS_GUILD_ID, BOOSTER_ROLE_ID } = require('../config/constants');

module.exports = {
    name: Events.GuildMemberUpdate,
    async execute(oldMember, newMember) {

        try {
            if (oldMember.guild.id !== GYM_CLASS_GUILD_ID || newMember.guild.id !== GYM_CLASS_GUILD_ID) return;
            const gymClassGuild = await newMember.client.guilds.fetch(GYM_CLASS_GUILD_ID);
            if (!gymClassGuild) return logger.error('Gym Class guild not found.');
            const gymClassMember = await gymClassGuild.members.fetch(newMember.id);
            if (!gymClassMember) return logger.error('Member not found in Gym Class guild.');
            const hadBoosterRole = oldMember.roles.cache.has(oldMember.guild.roles.premiumSubscriberRole.id);
            const hasBoosterRole = newMember.roles.cache.has(newMember.guild.roles.premiumSubscriberRole.id);
            if (hasBoosterRole && !hadBoosterRole) {
                await gymClassMember.roles.add(BOOSTER_ROLE_ID);
                logger.info(`Added booster role to ${gymClassMember.user.tag} in Gym Class server.`);
            } else if (!hasBoosterRole && hadBoosterRole) {
                await gymClassMember.roles.remove(BOOSTER_ROLE_ID);
                logger.info(`Removed booster role from ${gymClassMember.user.tag} in Gym Class server.`);
            }
        } catch (error) {
            logger.error('Error handling server boost event:', error);
        }
    },
};
