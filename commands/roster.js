const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const credentials = require('../resources/secret.json');

// --- Constants ---
const compWinSheetId = '1nO8wK4p27DgbOHQhuFrYfg1y78AvjYmw7yGYato1aus';
const infoSheetId = '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k';
const contentSheetId = '1TF-JPBZ62Jqxe0Ilb_-GAe5xcOjQz-lE6NSFlrmNRvI';

// --- Authorization function ---
function authorize() {
    const { client_email, private_key } = credentials;
    return new google.auth.JWT(
        client_email,
        null,
        private_key,
        // Keep readonly scope as it seems sufficient for this command
        ['https://www.googleapis.com/auth/spreadsheets.readonly']
    );
}

// --- Helper Function: Fetch Competitive Roster ---
// Needs updated Squad Leaders range and squadMade index
async function fetchCompetitiveRoster(sheets, compWinSheetId, infoSheetId, squadNameInput, squadNameNormalized, squadMade, leaderId, interaction) {
    try {
        // Get members from the competitive sheet (Assume this sheet structure is unchanged)
        const squadMembersResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: compWinSheetId,
            range: `'Squad Members'!A:ZZ`, // Read all columns to be safe
        });

        const squadMembersData = squadMembersResponse.data.values || [];
        if (squadMembersData.length < 1) {
            await interaction.editReply({ content: `Could not read headers from the competitive members sheet for "${squadNameInput}".` });
            return;
        }
        const squadMembersHeaders = squadMembersData.shift() || []; // Get headers, provide default empty array
        // Ensure date parsing is robust
        const dateColumns = squadMembersHeaders.slice(3).map(dateStr => {
            try {
                return new Date(dateStr);
            } catch (e) { return null; } // Handle invalid date headers
        }).filter(date => date !== null); // Filter out invalid dates

        // Filter members matching the normalized squad name (Assume squad name is Col B / index 1 here)
        const relevantMembers = squadMembersData.filter(row => row && row.length > 1 && row[1]?.trim().toLowerCase() === squadNameNormalized);

        if (relevantMembers.length === 0) {
            // This message is okay if we know it *should* be a competitive squad but has no members listed here
            await interaction.editReply({ content: `No members found listed in the competitive tracking sheet for squad "${squadNameInput}".` });
            return;
        }

        // Map members and calculate wins
        const membersWithWins = relevantMembers.map(memberRow => {
            const discordId = memberRow[0]?.trim(); // Assume Discord ID is Col A / index 0
            const joinedSquadStr = memberRow[2]?.trim(); // Assume Joined Date is Col C / index 2
            const joinedSquadDate = joinedSquadStr ? new Date(joinedSquadStr) : new Date(0); // Default to epoch if missing

            let totalWins = 0;
            for (let i = 3; i < squadMembersHeaders.length; i++) { // Start checking from Col D / index 3
                const winStr = memberRow[i]?.trim();
                const wins = parseInt(winStr) || 0;
                // Check against parsed, valid dateColumns
                if (i - 3 < dateColumns.length) {
                    const weekDate = dateColumns[i - 3];
                    if (weekDate && weekDate >= joinedSquadDate) { // Check if weekDate is valid
                        totalWins += wins;
                    }
                }
            }

            return {
                discordId,
                totalWins,
                isLeader: discordId === leaderId,
            };
        }).filter(m => m.discordId); // Ensure we only have members with an ID

        const totalSquadWins = membersWithWins.reduce((sum, member) => sum + member.totalWins, 0);
        const squadLevel = Math.floor(totalSquadWins / 50) + 1; // Or your specific level logic

        membersWithWins.sort((a, b) => {
            if (a.isLeader && !b.isLeader) return -1;
            if (!a.isLeader && b.isLeader) return 1;
            return b.totalWins - a.totalWins; // Sort by wins descending
        });

        // --- Build Embed ---
        const rosterEmbed = new EmbedBuilder()
            .setColor(0x0099ff) // Blue for Competitive
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
            { name: 'Squad Type', value: `Competitive`, inline: true },
            { name: 'Squad Formed', value: squadMade || 'Unknown', inline: true } // Display the passed squadMade date
        ).setTimestamp();

        await interaction.editReply({ embeds: [rosterEmbed] });

    } catch (error) {
        console.error(`Error in fetchCompetitiveRoster for ${squadNameInput}:`, error);
        await interaction.editReply({ content: 'An error occurred while fetching the competitive squad roster.' });
    }
}


// --- Helper Function: Fetch Content Roster ---
// Needs updated Squad Leaders range/squadMade index AND Squad Members range/indices
async function fetchContentRoster(sheets, contentSheetId, infoSheetId, squadNameInput, squadNameNormalized, squadMade, leaderId, interaction) {
    try {
        // Get post data (Assume contentSheetId structure is unchanged)
        const individualPostsResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: contentSheetId,
            range: `'Individual # of Posts'!A:Z`, // Read all columns
        });

        const individualPostsData = individualPostsResponse.data.values || [];
        if (individualPostsData.length < 1) {
            await interaction.editReply({ content: `Could not read headers from the content posts sheet for "${squadNameInput}".` });
            return;
        }
        const individualPostsHeaders = individualPostsData.shift() || [];
        // Default header assumption seems okay, but reading is safer.

        // Get squad members join dates from the main info sheet
        const squadMembersResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: infoSheetId,
            // *** UPDATED RANGE AND COLUMNS ***
            range: `'Squad Members'!A:E`, // Read A to E
        });
        const squadMembersData = (squadMembersResponse.data.values || []).slice(1); // Skip header

        // Filter relevant post data for the target squad (Assume squad name is Col B / index 1)
        const relevantPosts = individualPostsData.filter(row => row && row.length > 1 && row[1]?.trim().toLowerCase() === squadNameNormalized);

        if (relevantPosts.length === 0) {
            // This is okay if we know it *should* be Content but no members listed here
            await interaction.editReply({ content: `No members found listed in the content tracking sheet for squad "${squadNameInput}".` });
            return;
        }

        // Create a map of DiscordID -> JoinedDate for this squad from Squad Members sheet
        const squadMembersMap = new Map();
        for (const memberRow of squadMembersData) {
            // *** UPDATED INDICES ***
            const discordId = memberRow[1]?.trim(); // ID is now Col B / index 1
            const squad = memberRow[2]?.trim().toLowerCase(); // Squad is Col C / index 2
            const joinedSquadStr = memberRow[4]?.trim(); // Joined Date is now Col E / index 4

            if (discordId && squad === squadNameNormalized) {
                try {
                    const joinedDate = joinedSquadStr ? new Date(joinedSquadStr) : null;
                    if(joinedDate && !isNaN(joinedDate)) { // Check if date is valid
                        squadMembersMap.set(discordId, joinedDate);
                    } else {
                        squadMembersMap.set(discordId, new Date(0)); // Default if date missing/invalid
                        console.warn(`Invalid or missing join date for ${discordId} in squad ${squadNameInput}. Defaulting to epoch.`);
                    }
                } catch (e) {
                    squadMembersMap.set(discordId, new Date(0)); // Default on error
                    console.warn(`Error parsing join date for ${discordId} in squad ${squadNameInput}: ${joinedSquadStr}`);
                }
            }
        }

        // Parse date headers from content sheet (Assuming dates start at Col G / index 6)
        const dateColumns = individualPostsHeaders.slice(6).map(dateStr => {
            try { return new Date(dateStr); } catch (e) { return null; }
        }).filter(date => date && !isNaN(date));

        // Map members and calculate posts *since joining*
        const membersWithPosts = relevantPosts.map(row => {
            const discordId = row[0]?.trim(); // Assume ID is Col A / index 0
            if (!discordId) return null; // Skip rows without ID

            const joinedSquadDate = squadMembersMap.get(discordId) || new Date(0); // Get join date or default

            let postsCount = 0;
            // Calculate posts from weekly columns (index 6+)
            for (let i = 0; i < dateColumns.length; i++) {
                const weekDate = dateColumns[i];
                const weekColumnIndex = 6 + i; // Index in the row data
                if (weekDate >= joinedSquadDate) {
                    const posts = parseInt(row[weekColumnIndex]?.trim()) || 0;
                    postsCount += posts;
                }
            }

            // The original code also added row[5] ('Total for the week') unconditionally if the latest week was after joining.
            // This seems potentially duplicative if row[5] IS the latest week's data already looped above.
            // Let's refine: only sum the individual week columns (index 6+).
            // If row[5] represents something else (like a manual override total), the logic might need revisiting.
            // Assuming row[5] is redundant or less accurate than summing weeklies:
            // let latestWeekTotal = parseInt(row[5]?.trim()) || 0; // This was the old logic's 'Total for the week'

            return {
                discordId,
                totalPosts: postsCount, // Use sum of weeklies since join date
                isLeader: discordId === leaderId,
            };
        }).filter(m => m !== null); // Filter out null entries


        const totalSquadPosts = membersWithPosts.reduce((sum, member) => sum + member.totalPosts, 0);

        membersWithPosts.sort((a, b) => {
            if (a.isLeader && !b.isLeader) return -1;
            if (!a.isLeader && b.isLeader) return 1;
            return b.totalPosts - a.totalPosts; // Sort by posts descending
        });

        // --- Build Embed ---
        const rosterEmbed = new EmbedBuilder()
            .setColor(0x00ff00) // Green for Content
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
            { name: 'Squad Type', value: `Content`, inline: true },
            { name: 'Squad Formed', value: squadMade || 'Unknown', inline: true } // Display the passed squadMade date
        ).setTimestamp();

        await interaction.editReply({ embeds: [rosterEmbed] });

    } catch (error) {
        console.error(`Error in fetchContentRoster for ${squadNameInput}:`, error);
        await interaction.editReply({ content: 'An error occurred while fetching the content squad roster.' });
    }
}

// --- Helper Function: Fetch Non-Competitive Roster (Casual/Other) ---
// Needs updated Squad Leaders range/squadMade index AND Squad Members range
async function fetchNonCompetitiveRoster(sheets, infoSheetId, squadNameInput, squadNameNormalized, squadMade, leaderId, interaction, squadType) {
    try {
        // We already have leaderId and squadMade. Just need members.
        const membersResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: infoSheetId,
            // *** UPDATED RANGE ***
            range: `'Squad Members'!A:E`, // Read A to E
        });

        const membersData = (membersResponse.data.values || []).slice(1); // Skip header

        // Filter members for this squad (Squad Name is Col C / index 2)
        const relevantMembers = membersData.filter(row => row && row.length > 2 && row[2]?.trim().toLowerCase() === squadNameNormalized);

        // --- Build Embed ---
        const rosterEmbed = new EmbedBuilder()
            .setColor(0x808080) // Grey for Casual/Other
            .setTitle(`${squadNameInput.toUpperCase()} - Roster (${squadType || 'Unknown Type'})`) // Use passed type

        if (leaderId) {
            rosterEmbed.addFields( { name: 'Squad Leader', value: `<@${leaderId}>`, inline: false });
        } else {
            rosterEmbed.addFields( { name: 'Squad Leader', value: 'Not found', inline: false });
        }

        let memberList = 'No members found.';
        if (relevantMembers.length > 0) {
            memberList = relevantMembers
                // *** UPDATED INDEX ***
                .map(row => row[1]?.trim()) // Get ID from Col B / index 1
                .filter(id => id) // Filter out empty IDs
                .map(id => `<@${id}>`)
                .join('\n');
            if (!memberList) memberList = 'No valid member IDs found.'; // Handle case where IDs are empty/invalid
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


// --- Main Export ---
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
        await interaction.deferReply({ ephemeral: false }); // Public reply

        const squadNameInput = interaction.options.getString('squad').trim();
        const squadNameNormalized = squadNameInput.toLowerCase();
        const auth = authorize();
        const sheets = google.sheets({ version: 'v4', auth });

        try {
            // 1. Check Squad Leaders sheet first to confirm existence and get Leader/Made Date
            const squadLeadersResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: infoSheetId,
                // *** UPDATED RANGE ***
                range: `'Squad Leaders'!A:F`, // Read A to F
            });

            const squadLeadersData = (squadLeadersResponse.data.values || []).slice(1); // Skip header

            // Find the leader row by normalized squad name (Col C / index 2)
            const leaderRow = squadLeadersData.find(row => row && row.length > 2 && row[2]?.trim().toLowerCase() === squadNameNormalized);

            // *** IMPROVED NOT FOUND MESSAGE ***
            if (!leaderRow) {
                // Construct a more helpful message
                const notFoundEmbed = new EmbedBuilder()
                    .setColor(0xFF0000) // Red
                    .setTitle('Squad Not Found')
                    .setDescription(`Could not find a squad named "**${squadNameInput}**". Please ensure the spelling is correct (case-insensitive).`)
                    .setTimestamp();
                await interaction.editReply({ embeds: [notFoundEmbed] });
                // Consider adding suggestions based on slight misspellings if needed (more complex)
                return;
            }

            // Extract Leader ID and Squad Made Date
            const leaderId = leaderRow[1]?.trim(); // Leader ID is Col B / index 1
            // *** UPDATED INDEX ***
            const squadMade = leaderRow[5]?.trim(); // Squad Made is now Col F / index 5

            // 2. Get Squad Type from All Data sheet
            const allDataResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: infoSheetId,
                // *** UPDATED RANGE ***
                range: `'All Data'!A:H`, // Read A to H
            });
            const allData = (allDataResponse.data.values || []).slice(1); // Skip header

            // Find *any* row matching the squad name to get the type (Col C / index 2)
            const squadDataRow = allData.find(row => row && row.length > 2 && row[2]?.trim().toLowerCase() === squadNameNormalized);
            // Type is Col D / index 3
            const squadType = squadDataRow ? squadDataRow[3]?.trim() : 'Unknown'; // Default if not found in All Data

            // 3. Call the appropriate roster function based on type
            if (squadType === 'Competitive') {
                await fetchCompetitiveRoster(sheets, compWinSheetId, infoSheetId, squadNameInput, squadNameNormalized, squadMade, leaderId, interaction);
            } else if (squadType === 'Content') {
                await fetchContentRoster(sheets, contentSheetId, infoSheetId, squadNameInput, squadNameNormalized, squadMade, leaderId, interaction);
            } else {
                // Pass the determined squadType to the non-competitive fetcher
                await fetchNonCompetitiveRoster(sheets, infoSheetId, squadNameInput, squadNameNormalized, squadMade, leaderId, interaction, squadType);
            }

        } catch (error) {
            console.error(`Error fetching roster for ${squadNameInput}:`, error);
            // Avoid showing generic sheet errors to the user if possible
            await interaction.editReply({ content: 'An unexpected error occurred while trying to fetch the squad roster. Please try again later or contact an admin.' });
        }
    },
};