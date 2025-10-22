const { Events } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
    name: Events.MessageReactionAdd,
    async execute(reaction, user) {
        const channelIDs = ['764593469746315286', '807765316813324319',];
        const roleID = '1284910121004040404';
        const messageAgeLimit = 7 * 24 * 60 * 60 * 1000;
        if (user.bot) return;
        if (!channelIDs.includes(reaction.message.channel.id)) return;
        const messageTimestamp = reaction.message.createdTimestamp;
        const currentTimestamp = Date.now();
        if (currentTimestamp - messageTimestamp > messageAgeLimit) {
            console.log(`Reaction ignored for old message (over 7 days): ${reaction.message.id}`);
            return;
        }

        const guild = reaction.message.guild;
        const member = await guild.members.fetch(user.id);
        const role = guild.roles.cache.get(roleID);
        if (!role) {
            console.error(`Role with ID ${roleID} not found.`);
            return;
        }

        try {
            await member.roles.add(role);
            console.log(`Role ${role.name} assigned to ${member.user.tag} for reacting to a recent message.`);

            setTimeout(async () => {
                try {
                    await member.roles.remove(role);
                    console.log(`Role ${role.name} removed from ${member.user.tag} after 24 hours.`);
                } catch (error) {
                    console.error(`Failed to remove role ${role.name} from ${member.user.tag}:`, error);
                }
            }, 24 * 60 * 60 * 1000);

            const timeoutsFile = path.join(__dirname, '../resources/timeouts.json');
            const timeoutsData = fs.existsSync(timeoutsFile) ? JSON.parse(fs.readFileSync(timeoutsFile, 'utf8')) : {};

            timeoutsData[member.user.id] = {
                roleID: roleID,
                timeoutEnd: Date.now() + 24 * 60 * 60 * 1000
            };

            fs.writeFileSync(timeoutsFile, JSON.stringify(timeoutsData, null, 2));
        } catch (error) {
            console.error(`Failed to assign role ${role.name} to ${member.user.tag}:`, error);
        }
    }
};
