const { schedule } = require('node-cron');
const { google } = require('googleapis');
const { EmbedBuilder } = require('discord.js');
const credentials = require('../resources/secret.json');

const SHEET_ID = '1yxGmKTN27i9XtOefErIXKgcbfi1EXJHYWH7wZn_Cnok';
const ROLES = [
    { min: 0, max: 3699, id: '1379598636068896828' },
    { min: 3700, max: 5099, id: '1379598705283432509' },
    { min: 5100, max: Infinity, id: '1379598755560685568' }
];
const EMOJIS = {
    '1379598636068896828': '<:BronzeRank:1382407449704792084>',
    '1379598705283432509': '<:SilverRank:1382407392339165316>',
    '1379598755560685568': '<:GoldRank:1382407328694796288>'
};
const THREAD_ID = '1396935260008353944';
const PARENT_CHANNEL_ID = '1083515855985442906';

function authorize () {
    const { client_email, private_key } = credentials;
    return new google.auth.JWT(
        client_email,
        null,
        private_key,
        ['https://www.googleapis.com/auth/spreadsheets.readonly']
    );
}

async function fetchMMRData () {
    const auth = authorize();
    const sheets = google.sheets({ version: 'v4', auth });
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
    const season = meta.data.sheets
        .map(s => s.properties.title)
        .filter(t => /^Season \d+$/.test(t))
        .sort((a, b) => parseInt(b.split(' ')[1]) - parseInt(a.split(' ')[1]))[0];
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${season}!G2:H`
    });
    return res.data.values || [];
}

async function updateRoles (client) {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const data = await fetchMMRData();
    const changes = [];
    const invalidIds = [];
    for (const row of data) {
        if (!row || row.length < 2) continue;
        let mmr;
        let discordId;
        for (const cell of row) {
            const v = cell?.trim();
            if (!v) continue;
            if (/^\d{17,19}$/.test(v)) discordId = v;
            else if (/^\d+$/.test(v)) mmr = parseInt(v);
        }
        if (mmr === undefined || discordId === undefined) continue;
        const targetRole = ROLES.find(r => mmr >= r.min && mmr <= r.max);
        if (!targetRole) continue;
        try {
            const member = await guild.members.fetch(discordId);
            const currentRole = ROLES.find(r => member.roles.cache.has(r.id));
            if (currentRole && currentRole.id === targetRole.id) continue;
            await Promise.all(ROLES.map(r => member.roles.remove(r.id).catch(() => {})));
            await member.roles.add(targetRole.id);
            changes.push({ id: member.id, old: currentRole?.id, now: targetRole.id });
        } catch (e) {
            if (e.code === 10007 || e?.rawError?.code === 10007) invalidIds.push(discordId);
            console.log('member update error', e);
        }
    }
    return { changes, invalidIds };
}

module.exports = {
    name: 'ready',
    execute (client) {
        schedule(
            '0 0 * * 3k',
            async () => {
                console.log('Running rank task');
                let result;
                try {
                    result = await updateRoles(client);
                } catch (e) {
                    console.log('Rank task error during updateRoles()', e);
                    return;
                }
                const { changes = [], invalidIds = [] } = result || {};
                if (!changes.length && !invalidIds.length) {
                    console.log('Rank task: no changes detected; no rank updates made');
                    return;
                }
                console.log(`Rank task: ${changes.length} change(s); ${invalidIds.length} invalid id(s)`);        
                const lines = changes.map(c => `<@${c.id}>, ${EMOJIS[c.old] || ''} --> ${EMOJIS[c.now]}`);
                if (invalidIds.length) {
                    lines.push('', 'Invalid Discord IDs:', invalidIds.join(', '));
                }
                const description = lines.join('\n');
                const embed = new EmbedBuilder()
                    .setTitle('Rank Change Log')
                    .setDescription(description)
                    .setTimestamp();
                let thread;
                try {
                    thread = await client.channels.fetch(THREAD_ID);
                } catch (error) {
                    console.error('Failed to fetch rank change log thread:', error);
                }
                if (!thread) {
                    const parent = await client.channels.fetch(PARENT_CHANNEL_ID);
                    thread = await parent.threads.create({ name: 'rank-change-log', autoArchiveDuration: 10080 });
                }
                if (thread.archived) await thread.setArchived(false);
                try {
                    await thread.send({ embeds: [embed] });
                } catch (e) {
                    console.log('thread send error', e);
                }
            },
            { timezone: 'America/Chicago' }
        );
    }
};
