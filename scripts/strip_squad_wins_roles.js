'use strict';

// One-time cleanup after the wins scrap (2026-08): removes the retired
// Top Comp Squad role and the four competitive level roles from everyone.
// Role ids are hard-coded because the constants were deleted with the system
// (they lived in config/constants.js and config/squads.js; see git history).
// Operator-run on the bot host: node scripts/strip_squad_wins_roles.js

require('dotenv').config({ path: './resources/.env' });
const { Client, GatewayIntentBits } = require('discord.js');

const GYM_CLASS_GUILD_ID = '752216589792706621';
const RETIRED_ROLE_IDS = [
    '1200889836844896316', // Top Comp Squad
    '1288918067178508423', // comp squad level 1
    '1288918165417365576', // comp squad level 2
    '1288918209294237707', // comp squad level 3
    '1288918281343733842', // comp squad level 4+
];

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

client.once('clientReady', async () => {
    try {
        const guild = await client.guilds.fetch(GYM_CLASS_GUILD_ID);
        const members = await guild.members.fetch();
        let stripped = 0;
        for (const [, member] of members) {
            const held = RETIRED_ROLE_IDS.filter((id) => member.roles.cache.has(id));
            if (held.length === 0) {
                continue;
            }
            await member.roles.remove(held).catch((e) => console.error(`failed for ${member.id}: ${e.message}`));
            stripped += 1;
        }
        console.log(`stripped retired roles from ${stripped} members`);
    } catch (error) {
        console.error('STRIP FAILED:', error);
        process.exitCode = 1;
    } finally {
        client.destroy();
    }
});

client.login(process.env.TOKEN);
