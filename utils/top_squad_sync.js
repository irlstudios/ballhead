'use strict';

const { getSheetsClient, getCachedValues } = require('./sheets_cache');
const { createCanvas } = require('canvas');
const {
    AttachmentBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
} = require('discord.js');
const {
    SPREADSHEET_COMP_WINS,
    SPREADSHEET_SQUADS,
    TOP_COMP_SQUAD_ROLE_ID,
    TOP_SQUAD_ANNOUNCEMENT_CHANNEL_ID,
    BALLHEAD_GUILD_ID,
} = require('../config/constants');
const { getSquadState, setSquadState } = require('../db');
const { findSquadMembers } = require('./squad_queries');
const logger = require('./logger');

let currentTopSquad = null;

async function loadTopSquadFromDB() {
    const state = await getSquadState('top_comp_squad');
    currentTopSquad = state ? state.value : null;
    return currentTopSquad;
}

function getCurrentTopSquad() {
    return currentTopSquad;
}

/**
 * Calculate total wins for each squad from the aggregate wins sheet.
 * Returns Map<squadName, { totalWins, squadType, squadMade }>
 */
async function calculateSquadWins(sheets) {
    const results = await getCachedValues({
        sheets,
        spreadsheetId: SPREADSHEET_COMP_WINS,
        ranges: ["'Squads + Aggregate Wins'!A:ZZ"],
        ttlMs: 60000,
    });
    const rows = results.get("'Squads + Aggregate Wins'!A:ZZ") || [];
    const data = rows.slice(1);

    const squadWins = new Map();
    for (const row of data) {
        if (!row || !row[0]) continue;
        const squadName = row[0];
        const squadType = row[1] || '';
        const squadMade = row[2] || '';
        let totalWins = 0;
        for (let i = 3; i < row.length; i++) {
            const val = parseInt(row[i], 10);
            if (!isNaN(val)) totalWins += val;
        }
        squadWins.set(squadName, { totalWins, squadType, squadMade });
    }
    return squadWins;
}

/**
 * Get the latest week's wins for each squad.
 * Returns Map<squadName, weeklyWins>
 */
async function getWeeklyWins(sheets) {
    const results = await getCachedValues({
        sheets,
        spreadsheetId: SPREADSHEET_COMP_WINS,
        ranges: ["'Squads + Aggregate Wins'!A:ZZ"],
        ttlMs: 60000,
    });
    const rows = results.get("'Squads + Aggregate Wins'!A:ZZ") || [];
    const headers = rows[0] || [];
    const data = rows.slice(1);

    // Find the last date column with any data
    let lastColIndex = headers.length - 1;
    while (lastColIndex >= 3) {
        const hasData = data.some(row => row[lastColIndex] && parseInt(row[lastColIndex], 10) > 0);
        if (hasData) break;
        lastColIndex--;
    }

    const weeklyWins = new Map();
    for (const row of data) {
        if (!row || !row[0]) continue;
        const val = parseInt(row[lastColIndex], 10);
        weeklyWins.set(row[0], isNaN(val) ? 0 : val);
    }
    return { weeklyWins, weekLabel: headers[lastColIndex] || 'This Week' };
}

/**
 * Find the #1 competitive squad(s) by total wins.
 */
function findTopSquads(squadWins) {
    let maxWins = 0;
    const topSquads = [];

    for (const [name, data] of squadWins) {
        if (data.squadType !== 'Competitive') continue;
        if (data.totalWins > maxWins) {
            maxWins = data.totalWins;
            topSquads.length = 0;
            topSquads.push(name);
        } else if (data.totalWins === maxWins && maxWins > 0) {
            topSquads.push(name);
        }
    }

    return { topSquads, maxWins };
}

/**
 * Build the announcement canvas image.
 */
function buildAnnouncementImage(topSquads, maxWins, memberNames) {
    const rowCount = Math.ceil(memberNames.length / 3);
    const height = Math.max(500, 370 + rowCount * 50 + 50);
    const canvas = createCanvas(1000, height);
    const ctx = canvas.getContext('2d');

    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#4B0082');
    gradient.addColorStop(1, '#8A2BE2');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.font = 'bold 50px "Anton SC", "Bebas Neue", sans-serif';
    ctx.fillStyle = '#FFD700';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
    ctx.shadowBlur = 5;
    ctx.textAlign = 'center';
    ctx.fillText('Top Comp Squad', 500, 70);

    ctx.font = 'bold 80px "Anton SC", "Bebas Neue", sans-serif';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(topSquads.join(' & '), 500, 180);

    ctx.font = 'bold 40px "Anton SC", "Bebas Neue", sans-serif';
    ctx.fillStyle = '#FFD700';
    ctx.fillText(`${maxWins} Total Wins`, 500, 250);

    ctx.font = 'bold 30px "Anton SC", "Bebas Neue", sans-serif';
    ctx.fillStyle = '#C0C0C0';
    ctx.fillText('Members:', 500, 320);

    const membersPerRow = 3;
    for (let i = 0; i < memberNames.length; i++) {
        const row = Math.floor(i / membersPerRow);
        const col = i % membersPerRow;
        const x = 200 + col * 250;
        const y = 370 + row * 50;
        ctx.font = 'bold 24px "Anton SC", "Bebas Neue", sans-serif';
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(memberNames[i], x, y);
    }

    return new AttachmentBuilder(canvas.toBuffer(), { name: 'top-squad.png' });
}

/**
 * Main sync: determine top squad, sync role, post announcement.
 */
async function syncTopSquad(client, announce = true) {
    const sheets = await getSheetsClient();
    const guild = await client.guilds.fetch(BALLHEAD_GUILD_ID);

    const squadWins = await calculateSquadWins(sheets);
    const { topSquads, maxWins } = findTopSquads(squadWins);

    if (topSquads.length === 0) {
        logger.info('[Top Squad Sync] No competitive squads with wins found.');
        return;
    }

    const squadsResults = await getCachedValues({
        sheets,
        spreadsheetId: SPREADSHEET_SQUADS,
        ranges: ['Squad Members!A:E', 'Squad Leaders!A:G'],
        ttlMs: 30000,
    });
    const squadMembersData = (squadsResults.get('Squad Members!A:E') || []).slice(1);
    const squadLeadersData = (squadsResults.get('Squad Leaders!A:G') || []).slice(1);

    const topMemberIds = new Set();
    const topMemberNames = [];

    for (const squadName of topSquads) {
        const members = findSquadMembers(squadMembersData, squadName);
        for (const row of members) {
            if (row[1]) topMemberIds.add(row[1]);
        }
        const leader = squadLeadersData.find(
            r => r && r.length > 2 && r[2]?.toUpperCase() === squadName.toUpperCase()
        );
        if (leader && leader[1]) topMemberIds.add(leader[1]);
    }

    const role = await guild.roles.fetch(TOP_COMP_SQUAD_ROLE_ID);
    if (!role) {
        logger.error('[Top Squad Sync] Top Comp Squad role not found.');
        return;
    }

    const allMembers = await guild.members.fetch();

    for (const [memberId, member] of allMembers) {
        const hasRole = member.roles.cache.has(TOP_COMP_SQUAD_ROLE_ID);
        const shouldHaveRole = topMemberIds.has(memberId);

        if (shouldHaveRole && !hasRole) {
            await member.roles.add(TOP_COMP_SQUAD_ROLE_ID).catch(e =>
                logger.error(`[Top Squad Sync] Failed to add role to ${memberId}:`, e.message)
            );
        } else if (!shouldHaveRole && hasRole) {
            await member.roles.remove(TOP_COMP_SQUAD_ROLE_ID).catch(e =>
                logger.error(`[Top Squad Sync] Failed to remove role from ${memberId}:`, e.message)
            );
        }

        if (shouldHaveRole && member.user) {
            topMemberNames.push(member.displayName);
        }
    }

    const topSquadValue = topSquads.join(',');
    await setSquadState('top_comp_squad', topSquadValue);
    currentTopSquad = topSquadValue;

    if (announce) {
        try {
            const channel = await guild.channels.fetch(TOP_SQUAD_ANNOUNCEMENT_CHANNEL_ID);
            if (channel) {
                const attachment = buildAnnouncementImage(topSquads, maxWins, topMemberNames);
                const container = new ContainerBuilder();
                container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('## Top Comp Squad of the Week')
                );
                container.addMediaGalleryComponents(
                    new MediaGalleryBuilder().addItems(
                        new MediaGalleryItemBuilder().setURL('attachment://top-squad.png')
                    )
                );
                await channel.send({
                    flags: MessageFlags.IsComponentsV2,
                    components: [container],
                    files: [attachment],
                });
            }
        } catch (err) {
            logger.error('[Top Squad Sync] Failed to post announcement:', err.message);
        }
    }

    logger.info(`[Top Squad Sync] Top squad: ${topSquads.join(', ')} with ${maxWins} wins. Role synced for ${topMemberIds.size} members.`);
}

module.exports = {
    syncTopSquad,
    loadTopSquadFromDB,
    getCurrentTopSquad,
    calculateSquadWins,
    getWeeklyWins,
    findTopSquads,
};
