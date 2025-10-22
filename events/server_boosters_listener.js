const { Events } = require('discord.js');

module.exports = {
    name: Events.GuildMemberUpdate,
    async execute(oldMember, newMember) {
        const BALLHEAD_GUILD_ID = '1233740086839869501';
        const GYM_CLASS_GUILD_ID = '752216589792706621';
        const BOOSTER_ROLE_ID = '1251901885837873232';

        try {
            if (oldMember.guild.id !== BALLHEAD_GUILD_ID || newMember.guild.id !== BALLHEAD_GUILD_ID) return;
            const gymClassGuild = await newMember.client.guilds.fetch(GYM_CLASS_GUILD_ID);
            if (!gymClassGuild) return console.error('Gym Class guild not found.');
            const gymClassMember = await gymClassGuild.members.fetch(newMember.id);
            if (!gymClassMember) return console.error('Member not found in Gym Class guild.');
            const hadBoosterRole = oldMember.roles.cache.has(oldMember.guild.roles.premiumSubscriberRole.id);
            const hasBoosterRole = newMember.roles.cache.has(newMember.guild.roles.premiumSubscriberRole.id);
            if (hasBoosterRole && !hadBoosterRole) {
                await gymClassMember.roles.add(BOOSTER_ROLE_ID);
                console.log(`Added booster role to ${gymClassMember.user.tag} in Gym Class server.`);
            } else if (!hasBoosterRole && hadBoosterRole) {
                await gymClassMember.roles.remove(BOOSTER_ROLE_ID);
                console.log(`Removed booster role from ${gymClassMember.user.tag} in Gym Class server.`);
            }
        } catch (error) {
            console.error('Error handling server boost event:', error);
        }
    },
};
