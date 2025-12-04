const { schedule } = require('node-cron');
const { google } = require('googleapis');
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const { createCanvas, registerFont } = require('canvas');
const credentials = require('../resources/secret.json');

const SQUAD_INFO_SHEET_ID = '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k';
const AGGREGATED_SCORES_SHEET_ID = '1nO8wK4p27DgbOHQhuFrYfg1y78AvjYmw7yGYato1aus';

const LEADERBOARD_CHANNEL_ID = '1214781415670153266';

const roles = {
    competitive: {
        1: '1288918067178508423',
        10: '1288918165417365576',
        25: '1288918209294237707',
        50: '1288918281343733842',
    },
    content: {
        1: '1291090496869109762',
        10: '1291090569346682931',
        25: '1291090608315699229',
        50: '1291090760405356708',
    },
};

try {
    registerFont('./resources/Fonts/AntonSC-Regular.ttf', { family: 'Anton SC' });
    registerFont('./resources/Fonts/BebasNeue-Regular.ttf', { family: 'Bebas Neue' });
} catch (error) {
    console.error('Error loading fonts:', error);
}

function authorize() {
    const { client_email, private_key } = credentials;
    return new google.auth.JWT({
        email: client_email,
        key: private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
    });
}

function drawRoundedRect(ctx, x, y, width, height, radius, fillColor, borderColor) {
    ctx.fillStyle = fillColor;
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
}

function drawLeaderboardEntry(ctx, startX, yPosition, boxWidth, squadName, lastWeekStat, allTimeLevel, rankColor, isCompetitive) {
    drawRoundedRect(ctx, startX, yPosition, boxWidth, 90, 20, '#365577', '#FFFFFF');

    ctx.font = 'bold 25px "Bebas Neue", sans-serif';
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'left';
    ctx.fillText(squadName, startX + 20, yPosition + 30);

    ctx.textAlign = 'left';
    ctx.fillText(lastWeekStat, startX + 20, yPosition + 60);

    ctx.font = 'bold 25px "Bebas Neue", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(allTimeLevel, startX + boxWidth - 20, yPosition + 30);
}

async function fetchCompetitiveSquads(auth) {
    const sheets = google.sheets({ version: 'v4', auth });
    const squadWinsSheetId = AGGREGATED_SCORES_SHEET_ID;
    const range = `'Squads + Aggregate Wins'!A1:ZZ`;

    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: squadWinsSheetId,
        range,
    });

    const data = response.data.values;
    if (!data || data.length < 2) {
        throw new Error('No data found in the "Squads + Aggregate Wins" sheet.');
    }

    const headers = data[0];
    const lastWeekIndex = headers.length - 1;

    const squadTotalWinsMap = {};
    const squadLastWeekWinsMap = {};

    const squadRows = data.slice(1);

    squadRows.forEach(row => {
        const squadName = row[0]?.trim();
        const squadType = row[1]?.trim();
        const winsArray = row.slice(3);

        const totalWins = winsArray.reduce((total, wins) => total + (parseInt(wins) || 0), 0);
        const lastWeekWins = parseInt(row[lastWeekIndex]) || 0;

        if (squadName && squadType === 'Competitive') {
            squadTotalWinsMap[squadName] = totalWins;
            squadLastWeekWinsMap[squadName] = lastWeekWins;
        }
    });

    const squads = Object.keys(squadTotalWinsMap).map(squadName => {
        const totalWins = squadTotalWinsMap[squadName];
        const lastWeekWins = squadLastWeekWinsMap[squadName];
        const level = Math.floor(totalWins / 50) + 1;
        return {
            squadName,
            totalWins,
            lastWeekWins,
            level,
        };
    });

    return squads.sort((a, b) => b.lastWeekWins - a.lastWeekWins).slice(0, 10);
}

async function fetchContentSquads(auth) {
    const sheets = google.sheets({ version: 'v4', auth });
    const sheetId = '1TF-JPBZ62Jqxe0Ilb_-GAe5xcOjQz-lE6NSFlrmNRvI';
    const range = `'Total Posts Per Squad'!A1:ZZ`;

    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range,
    });

    const data = response.data.values;
    if (!data || data.length < 2) {
        throw new Error('No data found in the "Total Posts Per Squad" sheet.');
    }

    const headers = data[0];

    const dateColumnStartIndex = headers.findIndex(header => {
        return header && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(header.trim());
    });

    if (dateColumnStartIndex === -1) {
        throw new Error('No date columns found in the headers.');
    }

    let lastWeekIndex = headers.length - 1;
    while (!headers[lastWeekIndex] || !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(headers[lastWeekIndex].trim())) {
        lastWeekIndex--;
        if (lastWeekIndex < dateColumnStartIndex) {
            throw new Error('No valid date columns found in the headers.');
        }
    }

    const squadsData = data.slice(1);
    const squadTotalPostsMap = {};
    const squadLastWeekPostsMap = {};

    squadsData.forEach(row => {
        const squadName = row[0];

        if (!squadName) {
            return;
        }

        const postsArray = row.slice(dateColumnStartIndex).map(val => parseInt(val) || 0);
        const totalPosts = postsArray.reduce((total, posts) => total + posts, 0);

        const lastWeekPostsValue = row[lastWeekIndex];
        const lastWeekPosts = parseInt(lastWeekPostsValue) || 0;

        squadTotalPostsMap[squadName] = totalPosts;
        squadLastWeekPostsMap[squadName] = lastWeekPosts;
    });

    const squads = Object.keys(squadTotalPostsMap).map(squadName => {
        const totalPosts = squadTotalPostsMap[squadName];
        const lastWeekPosts = squadLastWeekPostsMap[squadName];
        const level = Math.floor(totalPosts / 15) + 1;
        return {
            squadName,
            totalPosts,
            lastWeekPosts,
            level,
        };
    });

    return squads.sort((a, b) => b.lastWeekPosts - a.lastWeekPosts).slice(0, 10);
}


function generateLeaderboardImage(isCompetitive, squads) {
    let canvasWidth, canvasHeight, titleText;

    if (isCompetitive) {
        canvasWidth = 1000;
        canvasHeight = 1400;
        titleText = 'Competitive Squad Leaderboard';
    } else {
        canvasWidth = 1000;
        canvasHeight = 1400;
        titleText = 'Content Squad Leaderboard';
    }

    const canvas = createCanvas(canvasWidth, canvasHeight);
    const ctx = canvas.getContext('2d');

    if (isCompetitive) {
        const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
        gradient.addColorStop(0, '#141E30');
        gradient.addColorStop(1, '#243B55');
        ctx.fillStyle = gradient;
    } else {
        const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
        gradient.addColorStop(0, '#0f0c29');
        gradient.addColorStop(1, '#302b63');
        ctx.fillStyle = gradient;
    }
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.font = 'bold 55px "Anton SC", "Bebas Neue", sans-serif';
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.fillText(titleText, canvas.width / 2, 90);

    const startX = 50;
    const startY = 180;
    const boxWidth = 900;
    const boxHeight = 90;
    const boxSpacing = 20;

    squads.forEach((squad, index) => {
        const yPosition = startY + index * (boxHeight + boxSpacing);
        const isTop3 = index < 3;
        const rankColor = isTop3 ? ['#FFD700', '#C0C0C0', '#CD7F32'][index] : '#FFFFFF';

        const squadName = isCompetitive ? `#${index + 1} ${squad.squadName}` : `${squad.squadName}`;
        const lastWeekStat = isCompetitive ? `Last Week: ${squad.lastWeekWins} Wins` : `Last Week: ${squad.lastWeekPosts} Posts`;
        const allTimeLevel = `All-Time Level: ${squad.level}`;

        drawLeaderboardEntry(ctx, startX, yPosition, boxWidth, squadName, lastWeekStat, allTimeLevel, rankColor, isCompetitive);
    });

    return canvas.toBuffer();
}

async function assignRoles(client, auth, competitiveSquads, contentSquads) {
    const guild = client.guilds.cache.first();
    if (!guild) {
        console.error('Bot is not in any guild.');
        return;
    }

    const sheets = google.sheets({ version: 'v4', auth });

    const squadMembersResponse = await sheets.spreadsheets.values.get({
        spreadsheetId: SQUAD_INFO_SHEET_ID,
        range: `'Squad Members'!A1:D`,
    });

    const squadMembersData = squadMembersResponse.data.values;
    if (!squadMembersData || squadMembersData.length < 2) {
        console.error('No data found in the "Squad Members" sheet.');
        return;
    }

    const squadLeadersResponse = await sheets.spreadsheets.values.get({
        spreadsheetId: SQUAD_INFO_SHEET_ID,
        range: `'Squad Leaders'!A1:D`,
    });

    const squadLeadersData = squadLeadersResponse.data.values;
    if (!squadLeadersData || squadLeadersData.length < 2) {
        console.error('No data found in the "Squad Leaders" sheet.');
        return;
    }

    const membersMap = {};
    squadMembersData.slice(1).forEach(row => {
        const discordId = row[1];
        const squadName = row[2];
        if (discordId && squadName) {
            if (!membersMap[squadName]) {
                membersMap[squadName] = [];
            }
            membersMap[squadName].push(discordId);
        }
    });

    const leadersMap = {};
    squadLeadersData.slice(1).forEach(row => {
        const discordId = row[1];
        const squadName = row[2];
        if (discordId && squadName) {
            leadersMap[squadName] = discordId;
        }
    });

    const assignRolesForSquads = async (squads, type) => {
        for (const squad of squads) {
            const { squadName, level } = squad;
            let roleId;

            if (type === 'Competitive') {
                if (level >= 50) roleId = roles.competitive[50];
                else if (level >= 25) roleId = roles.competitive[25];
                else if (level >= 10) roleId = roles.competitive[10];
                else roleId = roles.competitive[1];
            } else if (type === 'Content') {
                if (level >= 50) roleId = roles.content[50];
                else if (level >= 25) roleId = roles.content[25];
                else if (level >= 10) roleId = roles.content[10];
                else roleId = roles.content[1];
            }

            if (!roleId) continue;

            const role = guild.roles.cache.get(roleId);
            if (!role) {
                console.error(`Role ID ${roleId} not found in guild.`);
                continue;
            }

            const memberIds = membersMap[squadName] || [];
            for (const memberId of memberIds) {
                try {
                    const member = await guild.members.fetch(memberId);
                    if (member) {
                        if (!member.roles.cache.has(roleId)) {
                            await member.roles.add(role);
                            console.log(`Assigned role ${role.name} to member ${member.user.tag}`);
                        }
                    }
                } catch (error) {
                    console.error(`Error assigning role to member ID ${memberId}:`, error);
                }
            }

            const leaderId = leadersMap[squadName];
            if (leaderId) {
                try {
                    const leader = await guild.members.fetch(leaderId);
                    if (leader) {
                        if (!leader.roles.cache.has(roleId)) {
                            await leader.roles.add(role);
                            console.log(`Assigned role ${role.name} to leader ${leader.user.tag}`);
                        }
                    }
                } catch (error) {
                    console.error(`Error assigning role to leader ID ${leaderId}:`, error);
                }
            }
        }
    };

    await assignRolesForSquads(competitiveSquads, 'Competitive');
    await assignRolesForSquads(contentSquads, 'Content');
}

async function scheduledTask(client) {
    const auth = authorize();

    try {
        const competitiveSquads = await fetchCompetitiveSquads(auth);
        const contentSquads = await fetchContentSquads(auth);

        const competitiveImage = generateLeaderboardImage(true, competitiveSquads);
        const contentImage = generateLeaderboardImage(false, contentSquads);

        const channel = await client.channels.fetch(LEADERBOARD_CHANNEL_ID);
        if (!channel) {
            console.error(`Channel with ID ${LEADERBOARD_CHANNEL_ID} not found.`);
            return;
        }

        const competitiveEmbed = new EmbedBuilder()
            .setTitle('Competitive Squad Leaderboard')
            .setColor('#0099ff')
            .setImage('attachment://competitive_leaderboard.png')
            .setTimestamp()
            .setFooter({ text: 'Competitive Leaderboard', iconURL: 'https://ballhead.app/squad-leaderboard' });

        const contentEmbed = new EmbedBuilder()
            .setTitle('Content Squad Leaderboard')
            .setColor('#0099ff')
            .setImage('attachment://content_leaderboard.png')
            .setTimestamp()
            .setFooter({ text: 'Content Leaderboard', iconURL: 'https://ballhead.app/squad-leaderboard' });

        const announcementMessage = `<@&1218468103382499400>

**📈 Weekly Squad Performance Update 📈**

🎉 **Congratulations to the squads who secured 1st place in both Competitive and Content categories!**

🔔 **Stay tuned in #announcements later today** to find out who the top squads of the week are and who is earning Squad Weekly Rewards!`;

        await channel.send({
            content: announcementMessage,
            embeds: [competitiveEmbed, contentEmbed],
            files: [
                new AttachmentBuilder(competitiveImage, { name: 'competitive_leaderboard.png' }),
                new AttachmentBuilder(contentImage, { name: 'content_leaderboard.png' }),
            ],
        });

        console.log('Leaderboards and announcement posted successfully.');

        await assignRoles(client, auth, competitiveSquads, contentSquads);
        console.log('Roles assigned successfully.');
    } catch (error) {
        console.error('Error in scheduled task:', error);
    }
}

module.exports = {
    name: 'ready',
    once: true,
    execute(client) {
        schedule('0 6 * * 3', () => {
            console.log('Running scheduled leaderboard task...');
            scheduledTask(client);
        }, {
            timezone: 'America/Chicago'
        });
    },
};