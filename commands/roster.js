const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const credentials = require('../resources/secret.json');

const compWinSheetId = '1nO8wK4p27DgbOHQhuFrYfg1y78AvjYmw7yGYato1aus';
const infoSheetId = '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k';
const contentSheetId = '1TF-JPBZ62Jqxe0Ilb_-GAe5xcOjQz-lE6NSFlrmNRvI';

function authorize() {
    const { client_email, private_key } = credentials;
    return new google.auth.JWT(
        client_email,
        null,
        private_key,
        ['https://www.googleapis.com/auth/spreadsheets.readonly']
    );
}


async function fetchAdditionalRoster(sheets, infoSheetId, contentSheetId, squadNameInput, squadNameNormalized, interaction) {
    try {
        const allDataResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: infoSheetId,
            range: `'All Data'!A2:F`,
        });

        const allDataRows = allDataResponse.data.values || [];
        const squadRow = allDataRows.find(row => row[2]?.trim().toLowerCase() === squadNameNormalized);
        const squadType = squadRow ? squadRow[3]?.trim() : 'Casual';
        const squadMade = squadRow ? squadRow[4]?.trim() : 'Unknown';

        console.log(`Additional Roster Data for Squad "${squadNameInput}":`, { squadType, squadMade });

        if (squadType === 'Content') {
            await fetchContentRoster(sheets, contentSheetId, infoSheetId, squadNameInput, squadNameNormalized, interaction);
        } else {
            await fetchNonCompetitiveRoster(sheets, infoSheetId, squadNameInput, squadNameNormalized, interaction);
        }
    } catch (error) {
        console.error('Error in fetchAdditionalRoster:', error);
        await interaction.editReply({ content: 'An error occurred while fetching additional roster data.' });
    }
}

async function fetchCompetitiveRoster(sheets, compWinSheetId, infoSheetId, squadNameInput, squadNameNormalized, squadMade, interaction) {
    try {
        const squadMembersResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: compWinSheetId,
            range: `'Squad Members'!A1:ZZ`,
        });

        const squadMembersData = squadMembersResponse.data.values || [];
        const squadMembersHeaders = squadMembersData.shift();
        const dateColumns = squadMembersHeaders.slice(3).map(dateStr => new Date(dateStr));

        const relevantMembers = squadMembersData.filter(row => row[1]?.trim().toLowerCase() === squadNameNormalized);

        if (relevantMembers.length === 0) {
            await interaction.editReply({ content: `No members found for the competitive squad "${squadNameInput}".` });
            return;
        }

        const squadLeadersResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: infoSheetId,
            range: `'Squad Leaders'!A2:D`,
        });

        const squadLeadersData = squadLeadersResponse.data.values || [];
        const leaderRow = squadLeadersData.find(row => row[2]?.trim().toLowerCase() === squadNameNormalized);
        const leaderId = leaderRow ? leaderRow[1]?.trim() : null;

        const membersWithWins = relevantMembers.map(memberRow => {
            const discordId = memberRow[0]?.trim();
            const joinedSquadStr = memberRow[2]?.trim();
            const joinedSquadDate = joinedSquadStr ? new Date(joinedSquadStr) : new Date(0);

            let totalWins = 0;
            for (let i = 3; i < squadMembersHeaders.length; i++) {
                const winStr = memberRow[i]?.trim();
                const wins = parseInt(winStr) || 0;
                const weekDate = dateColumns[i - 3];
                if (weekDate >= joinedSquadDate) {
                    totalWins += wins;
                }
            }

            return {
                discordId,
                totalWins,
                isLeader: discordId === leaderId,
            };
        });

        const totalSquadWins = membersWithWins.reduce((sum, member) => sum + member.totalWins, 0);
        const squadLevel = Math.floor(totalSquadWins / 50) + 1;

        membersWithWins.sort((a, b) => {
            if (a.isLeader && !b.isLeader) return -1;
            if (!a.isLeader && b.isLeader) return 1;
            return b.totalWins - a.totalWins;
        });

        const rosterEmbed = new EmbedBuilder()
            .setColor(0x0099ff)
            .setTitle(`${squadNameInput.toUpperCase()} - Roster (Competitive)`)
            .addFields(
                { name: 'Squad Level', value: `Level ${squadLevel} with a total of ${totalSquadWins} wins`, inline: false }
            );

        if (leaderId) {
            const leader = membersWithWins.find(member => member.isLeader);
            if (leader) {
                rosterEmbed.addFields(
                    { name: 'Squad Leader', value: `<@${leaderId}> - ${leader.totalWins} Wins`, inline: false }
                );
            } else {
                rosterEmbed.addFields(
                    { name: 'Squad Leader', value: `<@${leaderId}> - Wins data not found`, inline: false }
                );
            }
        } else {
            rosterEmbed.addFields(
                { name: 'Squad Leader', value: 'No leader found', inline: false }
            );
        }

        const members = membersWithWins.filter(member => !member.isLeader);
        if (members.length > 0) {
            const memberContributions = members
                .map(member => `<@${member.discordId}> - ${member.totalWins} Wins`)
                .join('\n') || 'No members found';

            rosterEmbed.addFields(
                { name: 'Squad Members', value: memberContributions, inline: false }
            );
        } else {
            rosterEmbed.addFields(
                { name: 'Squad Members', value: 'No members found', inline: false }
            );
        }

        rosterEmbed.addFields(
            { name: 'Squad Type', value: `Competitive`, inline: true },
            { name: 'Squad Made', value: `${squadMade}`, inline: true }
        );

        await interaction.editReply({ embeds: [rosterEmbed] });
    } catch (error) {
        console.error('Error in fetchCompetitiveRoster:', error);
        await interaction.editReply({ content: 'An error occurred while fetching the competitive squad roster.' });
    }
}


async function fetchContentRoster(sheets, contentSheetId, infoSheetId, squadNameInput, squadNameNormalized, interaction) {
    try {
        const individualPostsResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: contentSheetId,
            range: `'Individual # of Posts'!A2:S`,
        });

        const individualPostsData = individualPostsResponse.data.values || [];

        const individualPostsHeadersResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: contentSheetId,
            range: `'Individual # of Posts'!A1:Z`,
        });
        const individualPostsHeaders = individualPostsHeadersResponse.data.values[0] || ['DiscordID', 'Squad', 'TikTok', 'Reels', 'YouTube', 'Total for the week', '10/11/2024', '10/12/2024', '10/13/2024', '10/20/2024', '10/27/2024', '11/3/2024', '11/10/2024', '11/17/2024', '11/24/2024', '12/1/2024', '12/8/2024', '12/15/2024', '12/22/2024', '12/29/2024'];

        const squadMembersResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: infoSheetId,
            range: `'Squad Members'!A2:C`,
        });

        const squadMembersData = squadMembersResponse.data.values || [];
        const squadMembersHeaders = ['DiscordID', 'Squad', 'Joined Squad'];

        const squadLeadersResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: infoSheetId,
            range: `'Squad Leaders'!A2:D`,
        });

        const squadLeadersData = squadLeadersResponse.data.values || [];
        const leaderRow = squadLeadersData.find(row => row[2]?.trim().toLowerCase() === squadNameNormalized);
        const leaderId = leaderRow ? leaderRow[1]?.trim() : null;
        const squadMade = leaderRow ? leaderRow[3]?.trim() : 'Unknown';

        const relevantPosts = individualPostsData.filter(row => row[1]?.trim().toLowerCase() === squadNameNormalized);

        if (relevantPosts.length === 0) {
            await interaction.editReply({ content: `No members found for the content squad "${squadNameInput}".` });
            return;
        }

        const squadMembersMap = new Map();
        for (const memberRow of squadMembersData) {
            const discordId = memberRow[0]?.trim();
            const squad = memberRow[1]?.trim().toLowerCase();
            const joinedSquadStr = memberRow[2]?.trim();
            if (squad === squadNameNormalized) {
                const joinedSquadDate = joinedSquadStr ? new Date(joinedSquadStr) : null;
                if (discordId && joinedSquadDate) {
                    squadMembersMap.set(discordId, joinedSquadDate);
                }
            }
        }

        const dateColumns = individualPostsHeaders.slice(6).map(dateStr => new Date(dateStr));

        const membersWithPosts = relevantPosts.map(row => {
            const discordId = row[0]?.trim();
            const totalPosts = parseInt(row[5]) || 0;

            const joinedSquadDate = squadMembersMap.get(discordId) || new Date(0);

            let startWeekIndex = dateColumns.findIndex(weekDate => weekDate >= joinedSquadDate);
            if (startWeekIndex === -1) {
                startWeekIndex = dateColumns.length;
            }

            let postsCount = 0;
            for (let i = startWeekIndex; i < dateColumns.length; i++) {
                const weekDate = dateColumns[i];
                const weekColumn = 6 + i;
                const posts = parseInt(row[weekColumn]) || 0;
                postsCount += posts;
            }

            const latestWeekDate = dateColumns[dateColumns.length - 1];
            if (latestWeekDate >= joinedSquadDate) {
                const latestWeekPosts = parseInt(row[5]) || 0;
                postsCount += latestWeekPosts;
            }

            return {
                discordId,
                totalPosts: postsCount,
                isLeader: discordId === leaderId,
            };
        });

        const totalSquadPosts = membersWithPosts.reduce((sum, member) => sum + member.totalPosts, 0);

        membersWithPosts.sort((a, b) => {
            if (a.isLeader && !b.isLeader) return -1;
            if (!a.isLeader && b.isLeader) return 1;
            return b.totalPosts - a.totalPosts;
        });

        const rosterEmbed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle(`${squadNameInput.toUpperCase()} - Roster (Content)`)
            .addFields(
                { name: 'Total Posts', value: `${totalSquadPosts}`, inline: false }
            )

        if (leaderId) {
            const leader = membersWithPosts.find(member => member.isLeader);
            if (leader) {
                rosterEmbed.addFields(
                    { name: 'Squad Leader', value: `<@${leaderId}> - ${leader.totalPosts} Posts`, inline: false }
                );
            } else {
                rosterEmbed.addFields(
                    { name: 'Squad Leader', value: `<@${leaderId}> - Posts data not found`, inline: false }
                );
            }
        } else {
            rosterEmbed.addFields(
                { name: 'Squad Leader', value: 'No leader found', inline: false }
            );
        }

        const members = membersWithPosts.filter(member => !member.isLeader);
        if (members.length > 0) {
            const memberContributions = members
                .map(member => `<@${member.discordId}> - Total Posts: ${member.totalPosts}`)
                .join('\n') || 'No members found';

            rosterEmbed.addFields(
                { name: 'Squad Members', value: memberContributions, inline: false }
            );
        } else {
            rosterEmbed.addFields(
                { name: 'Squad Members', value: 'No members found', inline: false }
            );
        }

        rosterEmbed.addFields(
            { name: 'Squad Type', value: `Content`, inline: true },
            { name: 'Squad Made', value: `${squadMade}`, inline: true }
        );

        await interaction.editReply({ embeds: [rosterEmbed] });
    } catch (error) {
        console.error('Error in fetchContentRoster:', error);
        await interaction.editReply({ content: 'An error occurred while fetching the content squad roster.' });
    }
}

async function fetchNonCompetitiveRoster(sheets, infoSheetId, squadNameInput, squadNameNormalized, interaction) {
    try {
        const [leadersResponse, membersResponse] = await Promise.all([
            sheets.spreadsheets.values.get({
                spreadsheetId: infoSheetId,
                range: `'Squad Leaders'!A2:D`,
            }),
            sheets.spreadsheets.values.get({
                spreadsheetId: infoSheetId,
                range: `'Squad Members'!A2:D`,
            }),
        ]);

        const leadersData = leadersResponse.data.values || [];
        const membersData = membersResponse.data.values || [];

        const leaderRow = leadersData.find(row => row[2]?.trim().toLowerCase() === squadNameNormalized);
        const leaderId = leaderRow ? leaderRow[1]?.trim() : null;

        const relevantMembers = membersData.filter(row => row[2]?.trim().toLowerCase() === squadNameNormalized);

        const squadType = leaderRow ? leaderRow[2]?.trim() : 'Casual';
        const squadMade = leaderRow ? leaderRow[3]?.trim() : 'Unknown';

        const rosterEmbed = new EmbedBuilder()
            .setColor(0x0099ff)
            .setTitle(`${squadNameInput.toUpperCase()} - Roster (${squadType})`)
            .addFields(
                { name: 'Squad Type', value: `${squadType}`, inline: true },
                { name: 'Squad Made', value: `${squadMade}`, inline: true }
            );

        if (leaderId) {
            rosterEmbed.addFields(
                { name: 'Squad Leader', value: `<@${leaderId}>`, inline: false }
            );
        } else {
            rosterEmbed.addFields(
                { name: 'Squad Leader', value: 'No leader found', inline: false }
            );
        }

        if (relevantMembers.length > 0) {
            const memberList = relevantMembers
                .map(row => `<@${row[1]?.trim()}>`)
                .join('\n') || 'No members found';

            rosterEmbed.addFields(
                { name: 'Squad Members', value: memberList, inline: false }
            );
        } else {
            rosterEmbed.addFields(
                { name: 'Squad Members', value: 'No members found', inline: false }
            );
        }

        await interaction.editReply({ embeds: [rosterEmbed] });
    } catch (error) {
        console.error('Error in fetchNonCompetitiveRoster:', error);
        await interaction.editReply({ content: 'An error occurred while fetching the non-competitive squad roster.' });
    }
}

module.exports = {
    cooldown: 5,
    data: new SlashCommandBuilder()
        .setName('roster')
        .setDescription('Gets the roster for a specific squad')
        .addStringOption(option =>
            option.setName('squad')
                .setDescription('The name of the squad')
                .setRequired(true)
        ),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: false });

        const squadNameInput = interaction.options.getString('squad').trim();
        const squadNameNormalized = squadNameInput.toLowerCase();
        const auth = authorize();
        const sheets = google.sheets({ version: 'v4', auth });

        try {
            const squadWinsResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: compWinSheetId,
                range: `'Squads + Aggregate Wins'!A2:C`,
            });

            const squadWinsData = squadWinsResponse.data.values || [];
            const squadRow = squadWinsData.find(row => row[0]?.trim().toLowerCase() === squadNameNormalized);

            if (!squadRow) {
                await fetchAdditionalRoster(sheets, infoSheetId, contentSheetId, squadNameInput, squadNameNormalized, interaction);
                return;
            }

            const squadType = squadRow[1]?.trim();
            const squadMade = squadRow[2]?.trim();

            if (squadType === 'Competitive') {
                await fetchCompetitiveRoster(sheets, compWinSheetId, infoSheetId, squadNameInput, squadNameNormalized, squadMade, interaction);
            } else if (squadType === 'Content') {
                await fetchContentRoster(sheets, contentSheetId, infoSheetId, squadNameInput, squadNameNormalized, interaction);
            } else {
                await fetchNonCompetitiveRoster(sheets, infoSheetId, squadNameInput, squadNameNormalized, interaction);
            }

        } catch (error) {
            console.error('Error fetching roster:', error);
            await interaction.editReply({ content: 'An error occurred while executing the command.' });
        }
    },
};