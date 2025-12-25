const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getSheetsClient } = require('../../utils/sheets_cache');

const compWinSheetId = '1nO8wK4p27DgbOHQhuFrYfg1y78AvjYmw7yGYato1aus';
const infoSheetId = '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k';
const contentSheetId = '1TF-JPBZ62Jqxe0Ilb_-GAe5xcOjQz-lE6NSFlrmNRvI';

async function fetchCompetitiveRoster(sheets, compWinSheetId, infoSheetId, squadNameInput, squadNameNormalized, squadMade, leaderId, interaction) {
    try {
        const squadMembersResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: compWinSheetId,
            range: '\'Squad Members\'!A:ZZ',
        });

        const squadMembersData = squadMembersResponse.data.values || [];
        if (squadMembersData.length < 1) {
            await interaction.editReply({ content: `Could not read headers from the competitive members sheet for "${squadNameInput}".` });
            return;
        }
        const squadMembersHeaders = squadMembersData.shift() || [];
        const dateColumns = squadMembersHeaders.slice(3).map(dateStr => {
            try {
                return new Date(dateStr);
            } catch { return null; }
        }).filter(date => date !== null);

        const relevantMembers = squadMembersData.filter(row => row && row.length > 1 && row[1]?.trim().toLowerCase() === squadNameNormalized);

        if (relevantMembers.length === 0) {
            await interaction.editReply({ content: `No members found listed in the competitive tracking sheet for squad "${squadNameInput}".` });
            return;
        }

        const membersWithWins = relevantMembers.map(memberRow => {
            const discordId = memberRow[0]?.trim();
            const joinedSquadStr = memberRow[2]?.trim();
            const joinedSquadDate = joinedSquadStr ? new Date(joinedSquadStr) : new Date(0);

            let totalWins = 0;
            for (let i = 3; i < squadMembersHeaders.length; i++) {
                const winStr = memberRow[i]?.trim();
                const wins = parseInt(winStr) || 0;
                if (i - 3 < dateColumns.length) {
                    const weekDate = dateColumns[i - 3];
                    if (weekDate && weekDate >= joinedSquadDate) {
                        totalWins += wins;
                    }
                }
            }

            return {
                discordId,
                totalWins,
                isLeader: discordId === leaderId,
            };
        }).filter(m => m.discordId);

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
                { name: 'Squad Level', value: `Level ${squadLevel} (${totalSquadWins} Total Wins)`, inline: false }
            );

        const leader = membersWithWins.find(member => member.isLeader);
        if (leaderId) {
            rosterEmbed.addFields(
                { name: 'Squad Leader', value: `<@${leaderId}> (${leader ? leader.totalWins + ' Wins' : 'Wins N/A'})`, inline: false }
            );
        } else {
            rosterEmbed.addFields( { name: 'Squad Leader', value: 'Not found', inline: false });
        }

        const members = membersWithWins.filter(member => !member.isLeader);
        let memberContributions = 'No other members found in competitive tracking.';
        if (members.length > 0) {
            memberContributions = members
                .map(member => `<@${member.discordId}> (${member.totalWins} Wins)`)
                .join('\n');
        }
        rosterEmbed.addFields( { name: 'Squad Members', value: memberContributions, inline: false });

        rosterEmbed.addFields(
            { name: 'Squad Type', value: 'Competitive', inline: true },
            { name: 'Squad Formed', value: squadMade || 'Unknown', inline: true }
        ).setTimestamp();

        await interaction.editReply({ embeds: [rosterEmbed] });

    } catch (error) {
        console.error(`Error in fetchCompetitiveRoster for ${squadNameInput}:`, error);
        await interaction.editReply({ content: 'An error occurred while fetching the competitive squad roster.' });
    }
}


async function fetchContentRoster(sheets, contentSheetId, infoSheetId, squadNameInput, squadNameNormalized, squadMade, leaderId, interaction) {
    try {
        const individualPostsResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: contentSheetId,
            range: '\'Individual # of Posts\'!A:Z',
        });

        const individualPostsData = individualPostsResponse.data.values || [];
        if (individualPostsData.length < 1) {
            await interaction.editReply({ content: `Could not read headers from the content posts sheet for "${squadNameInput}".` });
            return;
        }
        const individualPostsHeaders = individualPostsData.shift() || [];
        const squadMembersResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: infoSheetId,
            range: '\'Squad Members\'!A:E',
        });
        const squadMembersData = (squadMembersResponse.data.values || []).slice(1);
        const relevantPosts = individualPostsData.filter(row => row && row.length > 1 && row[1]?.trim().toLowerCase() === squadNameNormalized);

        if (relevantPosts.length === 0) {
            await interaction.editReply({ content: `No members found listed in the content tracking sheet for squad "${squadNameInput}".` });
            return;
        }

        const squadMembersMap = new Map();
        for (const memberRow of squadMembersData) {
            const discordId = memberRow[1]?.trim();
            const squad = memberRow[2]?.trim().toLowerCase();
            const joinedSquadStr = memberRow[4]?.trim();

            if (discordId && squad === squadNameNormalized) {
                try {
                    const joinedDate = joinedSquadStr ? new Date(joinedSquadStr) : null;
                    if(joinedDate && !isNaN(joinedDate)) {
                        squadMembersMap.set(discordId, joinedDate);
                    } else {
                        squadMembersMap.set(discordId, new Date(0));
                        console.warn(`Invalid or missing join date for ${discordId} in squad ${squadNameInput}. Defaulting to epoch.`);
                    }
                } catch (error) {
                    squadMembersMap.set(discordId, new Date(0));
                    console.warn(`Error parsing join date for ${discordId} in squad ${squadNameInput}: ${joinedSquadStr}`, error);
                }
            }
        }

        const dateColumns = individualPostsHeaders.slice(6).map(dateStr => {
            try { return new Date(dateStr); } catch { return null; }
        }).filter(date => date && !isNaN(date));

        const membersWithPosts = relevantPosts.map(row => {
            const discordId = row[0]?.trim();
            if (!discordId) return null;

            const joinedSquadDate = squadMembersMap.get(discordId) || new Date(0);

            let postsCount = 0;
            for (let i = 0; i < dateColumns.length; i++) {
                const weekDate = dateColumns[i];
                const weekColumnIndex = 6 + i;
                if (weekDate >= joinedSquadDate) {
                    const posts = parseInt(row[weekColumnIndex]?.trim()) || 0;
                    postsCount += posts;
                }
            }

            return {
                discordId,
                totalPosts: postsCount,
                isLeader: discordId === leaderId,
            };
        }).filter(m => m !== null);

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
                { name: 'Total Posts Tracked', value: `${totalSquadPosts} (Since Joining)`, inline: false }
            );

        const leader = membersWithPosts.find(member => member.isLeader);
        if (leaderId) {
            rosterEmbed.addFields(
                { name: 'Squad Leader', value: `<@${leaderId}> (${leader ? leader.totalPosts + ' Posts' : 'Posts N/A'})`, inline: false }
            );
        } else {
            rosterEmbed.addFields( { name: 'Squad Leader', value: 'Not found', inline: false });
        }

        const members = membersWithPosts.filter(member => !member.isLeader);
        let memberContributions = 'No other members found in content tracking.';
        if (members.length > 0) {
            memberContributions = members
                .map(member => `<@${member.discordId}> (${member.totalPosts} Posts)`)
                .join('\n');
        }
        rosterEmbed.addFields( { name: 'Squad Members', value: memberContributions, inline: false });

        rosterEmbed.addFields(
            { name: 'Squad Type', value: 'Content', inline: true },
            { name: 'Squad Formed', value: squadMade || 'Unknown', inline: true }
        ).setTimestamp();

        await interaction.editReply({ embeds: [rosterEmbed] });

    } catch (error) {
        console.error(`Error in fetchContentRoster for ${squadNameInput}:`, error);
        await interaction.editReply({ content: 'An error occurred while fetching the content squad roster.' });
    }
}

async function fetchNonCompetitiveRoster(sheets, infoSheetId, squadNameInput, squadNameNormalized, squadMade, leaderId, interaction, squadType) {
    try {
        const membersResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: infoSheetId,
            range: '\'Squad Members\'!A:E',
        });
        const membersData = (membersResponse.data.values || []).slice(1);
        const relevantMembers = membersData.filter(row => row && row.length > 2 && row[2]?.trim().toLowerCase() === squadNameNormalized);

        const rosterEmbed = new EmbedBuilder()
            .setColor(0x808080)
            .setTitle(`${squadNameInput.toUpperCase()} - Roster (${squadType || 'Unknown Type'})`);

        if (leaderId) {
            rosterEmbed.addFields( { name: 'Squad Leader', value: `<@${leaderId}>`, inline: false });
        } else {
            rosterEmbed.addFields( { name: 'Squad Leader', value: 'Not found', inline: false });
        }

        let memberList = 'No members found.';
        if (relevantMembers.length > 0) {
            memberList = relevantMembers
                .map(row => row[1]?.trim())
                .filter(id => id)
                .map(id => `<@${id}>`)
                .join('\n');
            if (!memberList) memberList = 'No valid member IDs found.';
        }
        rosterEmbed.addFields( { name: 'Squad Members', value: memberList, inline: false });

        rosterEmbed.addFields(
            { name: 'Squad Type', value: squadType || 'Unknown', inline: true },
            { name: 'Squad Formed', value: squadMade || 'Unknown', inline: true }
        ).setTimestamp();

        await interaction.editReply({ embeds: [rosterEmbed] });

    } catch (error) {
        console.error(`Error in fetchNonCompetitiveRoster for ${squadNameInput}:`, error);
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
        const sheets = await getSheetsClient();

        try {
            const squadLeadersResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: infoSheetId,
                range: '\'Squad Leaders\'!A:F',
            });

            const squadLeadersData = (squadLeadersResponse.data.values || []).slice(1);
            const leaderRow = squadLeadersData.find(row => row && row.length > 2 && row[2]?.trim().toLowerCase() === squadNameNormalized);
            if (!leaderRow) {
                const notFoundEmbed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('Squad Not Found')
                    .setDescription(`Could not find a squad named "**${squadNameInput}**". Please ensure the spelling is correct (case-insensitive).`)
                    .setTimestamp();
                await interaction.editReply({ embeds: [notFoundEmbed] });
                return;
            }

            const leaderId = leaderRow[1]?.trim();
            const squadMade = leaderRow[5]?.trim();

            const allDataResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: infoSheetId,
                range: '\'All Data\'!A:H',
            });
            const allData = (allDataResponse.data.values || []).slice(1);
            const squadDataRow = allData.find(row => row && row.length > 2 && row[2]?.trim().toLowerCase() === squadNameNormalized);
            const squadType = squadDataRow ? squadDataRow[3]?.trim() : 'Unknown';

            if (squadType === 'Competitive') {
                await fetchCompetitiveRoster(sheets, compWinSheetId, infoSheetId, squadNameInput, squadNameNormalized, squadMade, leaderId, interaction);
            } else if (squadType === 'Content') {
                await fetchContentRoster(sheets, contentSheetId, infoSheetId, squadNameInput, squadNameNormalized, squadMade, leaderId, interaction);
            } else {
                await fetchNonCompetitiveRoster(sheets, infoSheetId, squadNameInput, squadNameNormalized, squadMade, leaderId, interaction, squadType);
            }

        } catch (error) {
            console.error(`Error fetching roster for ${squadNameInput}:`, error);
            await interaction.editReply({ content: 'An unexpected error occurred while trying to fetch the squad roster. Please try again later or contact an admin.' });
        }
    },
};
