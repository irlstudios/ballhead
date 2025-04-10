const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const credentials = require('../resources/secret.json');
const moment = require('moment');

// --- Google Sheets Authentication ---
function authorize() {
    const { client_email, private_key } = credentials;
    const auth = new google.auth.JWT(
        client_email,
        null,
        private_key,
        ['https://www.googleapis.com/auth/spreadsheets']
    );
    return auth;
}

const sheets = google.sheets({ version: 'v4', auth: authorize() });
const sheetId = '15P8BKPbO2DQX6yRXmc9gzuL3iLxfu4ef83Jb8Bi8AJk';

// --- Ranges ---
const rangeReels = 'Reels!A:I'; // Application data (Date in D=3, DiscordID in C=2)

// --- CORRECTED Performance Data Range ---
// Fetches Columns K through AF as requested. Relevant data starts here.
const rangeIGData = 'IG NF Data!K:AF';

// --- Fetch User Data from Sheets ---
async function getUserData(discordId) {
    try {
        console.log(`[IG getUserData] Fetching data from Google Sheets for user ID: ${discordId}`);

        const [resReels, resIGData] = await Promise.all([
            sheets.spreadsheets.values.get({
                spreadsheetId: sheetId,
                range: rangeReels,
            }),
            sheets.spreadsheets.values.get({
                spreadsheetId: sheetId,
                range: rangeIGData, // Using specific range K:AF
            })
        ]);

        const rowsReels = resReels.data.values || [];
        const rowsIGData = resIGData.data.values || []; // Data now starts with Column K
        console.log(`[IG getUserData] Data fetched: ${rowsReels.length} rows in ${rangeReels}, ${rowsIGData.length} rows in ${rangeIGData}.`);

        // Find application row (Discord ID Col C, index 2 in Reels)
        let userReelsRow = null;
        for (const row of rowsReels) {
            if (row && row.length > 2 && row[2] === discordId) {
                userReelsRow = row;
                console.log(`[IG getUserData] Found application row for ${discordId} in ${rangeReels} sheet.`);
                break;
            }
        }

        if (!userReelsRow) {
            console.log(`[IG getUserData] No application row found for user ID ${discordId} in ${rangeReels} sheet.`);
            return null;
        }

        // Find performance data row in IG NF Data (range K:AF)
        // IMPORTANT: Skip first 2 rows (headers). Data rows start at sheet row 3 (index 2).
        // IMPORTANT: Discord ID is in Column L, which is the 2nd column in range K:AF (Index 1).
        let userIGDataRow = null;
        const discordIdIndexRelative = 1; // L is the 2nd col (index 1) when starting from K
        for (let i = 2; i < rowsIGData.length; i++) { // Start loop from index 2 (Sheet Row 3)
            const row = rowsIGData[i];
            // Check if row array exists and has enough columns fetched (at least up to Discord ID)
            if (row && row.length > discordIdIndexRelative && row[discordIdIndexRelative] === discordId) {
                userIGDataRow = row; // This row array starts with data from Column K
                console.log(`[IG getUserData] Found performance data row for ${discordId} at sheet row index ${i} in ${rangeIGData} sheet.`);
                break;
            }
        }

        if (!userIGDataRow) {
            console.log(`[IG getUserData] No performance data row found for user ID ${discordId} in ${rangeIGData} sheet (rows 3+).`);
        }

        // userIGDataRow now holds the array starting from Column K's data
        return { userReelsRow, userIGDataRow };
    } catch (error) {
        console.error(`[IG getUserData] Error fetching user data from Google Sheets (Range: ${rangeIGData}):`, error);
        return null;
    }
}

// --- Helper to get the next Monday ---
function getNextMonday() {
    const nextMonday = moment().day(8);
    return nextMonday;
}

// --- Discord Command Definition ---
module.exports = {
    data: new SlashCommandBuilder()
        .setName('check-reels-account')
        .setDescription('Checks your Instagram application status and 3-week requirement data.'),
    async execute(interaction) {
        const commandName = '/check-reels-account';
        console.log(`[${commandName}] Invoked by ${interaction.user.tag} (${interaction.user.id})`);

        try {
            await interaction.deferReply({ ephemeral: true });
            console.log(`[${commandName}] Reply deferred.`);

            const userId = interaction.user.id;
            const userData = await getUserData(userId);

            // Case 1: User has not applied at all
            if (!userData || !userData.userReelsRow) {
                await interaction.editReply({ content: `It looks like you haven't applied for the Instagram CC program yet, or we couldn't find your application record in the \`${rangeReels}\` sheet.`, ephemeral: true });
                console.log(`[${commandName}] User ${userId} has not applied or application record not found in ${rangeReels}.`);
                return;
            }

            const { userReelsRow, userIGDataRow } = userData;

            // --- Application Date Parsing (Col D, index 3 in Reels) ---
            const applicationDateStr = userReelsRow[3];
            if (!applicationDateStr) {
                console.error(`[${commandName}] Application date missing or empty in cell D for user ${userId} in ${rangeReels} sheet row:`, userReelsRow);
                await interaction.editReply({ content: `We found your application, but the application date cell (Column D) appears to be empty in our records (\`${rangeReels}\` sheet). Please contact support.`, ephemeral: true });
                return;
            }
            const trimmedDateStr = applicationDateStr.trim();
            const applicationDate = moment(trimmedDateStr, 'M/D/YYYY', true);
            if (!applicationDate.isValid()) {
                console.error(`[${commandName}] Invalid application date format for user ${userId} in ${rangeReels} (Col D). Original: '${applicationDateStr}', Trimmed: '${trimmedDateStr}'. Expected M/D/YYYY.`);
                await interaction.editReply({ content: `We found your application, but the date stored ('${applicationDateStr}') in the \`${rangeReels}\` sheet (Column D) doesn't seem to be in a recognizable MM/DD/YYYY format. Please contact support to check the sheet data.`, ephemeral: true });
                return;
            }

            const nextCheckDate = getNextMonday();
            const discordFormattedTimestamp = `<t:${nextCheckDate.unix()}:F>`;

            // Case 2: User applied, but performance data row not found in IG NF Data (K:AF, Row 3+)
            if (!userIGDataRow) {
                const applicationDateString = applicationDate.format('MMMM Do, YYYY');
                const response = `We found your application submitted on **${applicationDateString}**. Your performance data wasn't found in the \`${rangeIGData}\` tracking sheet (rows 3+). Data is typically updated weekly. Please check back around ${discordFormattedTimestamp}.`;
                await interaction.editReply({ content: response, ephemeral: true });
                console.log(`[${commandName}] User ${userId} applied on ${applicationDate.format('YYYY-MM-DD')}, but data not found in ${rangeIGData} sheet (rows 3+). Advised to check back ${discordFormattedTimestamp}.`);
                return;
            }

            // Case 3: User applied AND data found in IG NF Data (K:AF)
            // --- Data Extraction using RELATIVE indices from K:AF range ---
            // userIGDataRow array starts with data from Column K
            console.log(`[${commandName}] Found application and performance data for user ${userId}. Preparing stats embed from ${rangeIGData}.`);

            const requirements = { posts: 2, likes: 15 }; // VERIFY IG requirements

            const checkRequirements = (postsStr, likesStr) => {
                const posts = parseInt(postsStr, 10) || 0;
                const likes = parseInt(likesStr, 10) || 0;
                const metPosts = posts >= requirements.posts;
                const metLikes = likes >= requirements.likes;
                return { posts, likes, metPosts, metLikes };
            };

            // --- CORRECTED INDICES based on K:AF range ---
            // Col K (Username): Index 0
            // Col L (Discord ID): Index 1
            // Col P (Followers): Index 5
            // Col Q (W1 Posts): Index 6
            // Col S (W1 Likes): Index 8
            // Col U (W2 Posts): Index 10
            // Col W (W2 Likes): Index 12
            // Col Y (W3 Posts): Index 14
            // Col AA (W3 Likes): Index 16
            const followersStr = userIGDataRow[5] || 'N/A';    // Index 5 (Col P rel K)
            const week1 = checkRequirements(userIGDataRow[6], userIGDataRow[8]);    // Indices 6 (Q rel K), 8 (S rel K)
            const week2 = checkRequirements(userIGDataRow[10], userIGDataRow[12]);  // Indices 10 (U rel K), 12 (W rel K)
            const week3 = checkRequirements(userIGDataRow[14], userIGDataRow[16]);  // Indices 14 (Y rel K), 16 (AA rel K)


            const generateRequirementMessage = (weekLabel, weekData) => {
                let message = `**${weekLabel}:**\n` +
                    `Posts: \`${weekData.posts}\` | Avg Likes: \`${weekData.likes}\`\n`;
                if (!weekData.metPosts || !weekData.metLikes) {
                    message += '**Missing:** ';
                    const missing = [];
                    if (!weekData.metPosts) missing.push(`Need ≥ ${requirements.posts} posts`);
                    if (!weekData.metLikes) missing.push(`Need ≥ ${requirements.likes} avg likes`);
                    message += missing.join('; ');
                    message += '\n';
                } else {
                    message += '**Requirements Met** ✅\n';
                }
                return message;
            };

            const embed = new EmbedBuilder()
                .setTitle('📊 Your Instagram 3-Week Stats')
                .setColor('#E1306C')
                .setDescription(
                    `**Followers:** ${followersStr}\n\n` +
                    generateRequirementMessage('Week 1', week1) + '\n' +
                    generateRequirementMessage('Week 2', week2) + '\n' +
                    generateRequirementMessage('Week 3', week3)
                )
                .setTimestamp()
                .setFooter({ text: 'Instagram CC Requirements Check' });

            await interaction.editReply({ embeds: [embed], ephemeral: false });
            console.log(`[${commandName}] Successfully sent stats embed to user ${userId}.`);

        } catch (error) {
            console.error(`[${commandName}] Error executing command for user ${interaction.user.tag}:`, error);
            try {
                if (!interaction.replied || !interaction.deferred) {
                    await interaction.reply({ content: 'An unexpected error occurred while processing your request.', ephemeral: true });
                } else {
                    await interaction.editReply({ content: 'An unexpected error occurred while processing your request.', ephemeral: true });
                }
            } catch (followUpError) {
                console.error(`[${commandName}] Error sending error message to user:`, followUpError);
            }
        }
    },
};