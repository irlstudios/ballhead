const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const credentials = require('../resources/secret.json'); // Ensure this path is correct
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
const sheetId = '15P8BKPbO2DQX6yRXmc9gzuL3iLxfu4ef83Jb8Bi8AJk'; // Your Spreadsheet ID

// --- Sheet Ranges ---
const rangeYouTubeApp = 'YouTube!A:D'; // Application data (Platform, User, DiscordID, Date)
const rangeYTData = 'YT NF Data!O:AP'; // Performance data (Relevant block starts Col O, ends AP)

// --- Fetch User Data from Sheets ---
async function getUserData(discordId) {
    try {
        console.log(`[YT getUserData] Fetching data from Google Sheets for user ID: ${discordId}`);

        const [resYouTubeApp, resYTData] = await Promise.all([
            sheets.spreadsheets.values.get({
                spreadsheetId: sheetId,
                range: rangeYouTubeApp, // Fetch application data
            }),
            sheets.spreadsheets.values.get({
                spreadsheetId: sheetId,
                range: rangeYTData, // Fetch performance data (O:AP)
            })
        ]);

        const rowsYouTubeApp = resYouTubeApp.data.values || [];
        const rowsYTData = resYTData.data.values || []; // Data array starts with Column O
        console.log(`[YT getUserData] Data fetched: ${rowsYouTubeApp.length} rows in ${rangeYouTubeApp}, ${rowsYTData.length} rows in ${rangeYTData}.`);

        // Find application row (Discord ID Col C, index 2 in YouTube sheet)
        let userApplicationRow = null;
        for (const row of rowsYouTubeApp) {
            // Check length > 2 (index 2 is Discord ID)
            if (row && row.length > 2 && row[2] === discordId) {
                userApplicationRow = row;
                console.log(`[YT getUserData] Found application row for ${discordId} in ${rangeYouTubeApp} sheet.`);
                break;
            }
        }

        if (!userApplicationRow) {
            console.log(`[YT getUserData] No application row found for user ID ${discordId} in ${rangeYouTubeApp} sheet.`);
            return null; // Indicate user hasn't applied
        }

        // Find performance data row in YT NF Data (range O:AP)
        // IMPORTANT: Skip first 2 rows (headers). Data rows start at sheet row 3 (index 2).
        // IMPORTANT: Discord ID is in Column P, which is the 2nd column in range O:AP (Index 1).
        let userPerformanceRow = null;
        const discordIdIndexRelative = 1; // P is the 2nd col (index 1) when starting from O
        for (let i = 2; i < rowsYTData.length; i++) { // Start loop from index 2 (Sheet Row 3)
            const row = rowsYTData[i];
            // Check if row array exists and has enough columns (at least up to Discord ID)
            if (row && row.length > discordIdIndexRelative && row[discordIdIndexRelative] === discordId) {
                userPerformanceRow = row; // This row array starts with data from Column O
                console.log(`[YT getUserData] Found performance data row for ${discordId} at sheet row index ${i} in ${rangeYTData} sheet.`);
                break;
            }
        }

        if (!userPerformanceRow) {
            console.log(`[YT getUserData] No performance data row found for user ID ${discordId} in ${rangeYTData} sheet (rows 3+).`);
        }

        // Return both rows (performance row might be null)
        return { userApplicationRow, userPerformanceRow };
    } catch (error)
    {
        console.error(`[YT getUserData] Error fetching user data from Google Sheets (Range: ${rangeYTData}):`, error);
        return null; // Indicate failure
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
        .setName('check-youtube-account') // New command name
        .setDescription('Checks your YouTube application status and 3-week requirement data.'), // Updated description
    async execute(interaction) {
        const commandName = '/check-youtube-account';
        console.log(`[${commandName}] Invoked by ${interaction.user.tag} (${interaction.user.id})`);

        try {
            await interaction.deferReply({ ephemeral: true });
            console.log(`[${commandName}] Reply deferred.`);

            const userId = interaction.user.id;
            const userData = await getUserData(userId);

            // Case 1: User has not applied at all (no record in YouTube sheet)
            if (!userData || !userData.userApplicationRow) {
                await interaction.editReply({
                    content: `It looks like you haven't applied for the YouTube CC program yet, or we couldn't find your application record in the \`${rangeYouTubeApp}\` sheet.`,
                    ephemeral: true
                });
                console.log(`[${commandName}] User ${userId} has not applied or application record not found in ${rangeYouTubeApp}.`);
                return;
            }

            // User has applied (userApplicationRow exists)
            const { userApplicationRow, userPerformanceRow } = userData;

            // --- Application Date Parsing (Col D, index 3 in YouTube sheet) ---
            const applicationDateStr = userApplicationRow[3]; // Index 3 is Submitted At
            if (!applicationDateStr) {
                console.error(`[${commandName}] Application date missing or empty in cell D for user ${userId} in ${rangeYouTubeApp} sheet row:`, userApplicationRow);
                await interaction.editReply({ content: `We found your application, but the application date cell (Column D) appears to be empty in our records (\`${rangeYouTubeApp}\` sheet). Please contact support.`, ephemeral: true });
                return;
            }
            // Use robust parsing
            const trimmedDateStr = applicationDateStr.trim();
            const applicationDate = moment(trimmedDateStr, 'M/D/YYYY', true);
            if (!applicationDate.isValid()) {
                console.error(`[${commandName}] Invalid application date format for user ${userId} in ${rangeYouTubeApp} (Col D). Original: '${applicationDateStr}', Trimmed: '${trimmedDateStr}'. Expected M/D/YYYY.`);
                await interaction.editReply({ content: `We found your application, but the date stored ('${applicationDateStr}') in the \`${rangeYouTubeApp}\` sheet (Column D) doesn't seem to be in a recognizable MM/DD/YYYY format. Please contact support to check the sheet data.`, ephemeral: true });
                return;
            }

            const nextCheckDate = getNextMonday();
            const discordFormattedTimestamp = `<t:${nextCheckDate.unix()}:F}`;

            // Case 2: User applied, but performance data row not found in YT NF Data (O:AP, Row 3+)
            if (!userPerformanceRow) {
                const applicationDateString = applicationDate.format('MMMM Do, YYYY');
                const response = `We found your application submitted on **${applicationDateString}**. Your performance data wasn't found in the \`${rangeYTData}\` tracking sheet (rows 3+). Data is typically updated weekly. Please check back around ${discordFormattedTimestamp}.`;
                await interaction.editReply({ content: response, ephemeral: true });
                console.log(`[${commandName}] User ${userId} applied on ${applicationDate.format('YYYY-MM-DD')}, but data not found in ${rangeYTData} sheet (rows 3+). Advised to check back ${discordFormattedTimestamp}.`);
                return;
            }

            // Case 3: User applied AND data found in YT NF Data (O:AP)
            console.log(`[${commandName}] Found application and performance data for user ${userId}. Preparing stats embed from ${rangeYTData}.`);

            // --- Define Requirements (PLACEHOLDERS - VERIFY ACTUAL YT REQUIREMENTS) ---
            const requirements = {
                posts: 2,       // Or Videos?
                likes: 15       // Or Views? Average? Total?
            };
            const postsLabel = "Videos"; // Use appropriate term for YT
            const likesLabel = "Avg Views/Likes"; // Use appropriate term

            // --- Helper to check requirements ---
            const checkRequirements = (postsStr, likesStr) => {
                const posts = parseInt(postsStr, 10) || 0;
                const likes = parseInt(likesStr, 10) || 0;
                const metPosts = posts >= requirements.posts;
                const metLikes = likes >= requirements.likes;
                return { posts, likes, metPosts, metLikes };
            };

            // --- Data Extraction using RELATIVE indices from O:AP range ---
            // userPerformanceRow array starts with data from Column O
            // Col P (Discord ID): Index 1
            // Col T (Subscribers): Index 5
            // Col U (W1 Posts): Index 6
            // Col W (W1 Likes): Index 8
            // Col AA (W2 Posts): Index 12
            // Col AC (W2 Likes): Index 14
            // Col AF (W3 Posts): Index 17
            // Col AH (W3 Likes): Index 19
            const subscribersStr = userPerformanceRow[5] || 'N/A'; // Index 5 (Col T rel O)
            const week1 = checkRequirements(userPerformanceRow[6], userPerformanceRow[8]);    // Indices 6 (U rel O), 8 (W rel O)
            const week2 = checkRequirements(userPerformanceRow[12], userPerformanceRow[14]);  // Indices 12 (AA rel O), 14 (AC rel O)
            const week3 = checkRequirements(userPerformanceRow[17], userPerformanceRow[19]);  // Indices 17 (AF rel O), 19 (AH rel O)

            // --- Helper to generate embed description part ---
            const generateRequirementMessage = (weekLabel, weekData) => {
                let message = `**${weekLabel}:**\n` +
                    `${postsLabel}: \`${weekData.posts}\` | ${likesLabel}: \`${weekData.likes}\`\n`; // Use dynamic labels
                if (!weekData.metPosts || !weekData.metLikes) {
                    message += '**Missing:** ';
                    const missing = [];
                    if (!weekData.metPosts) missing.push(`Need ≥ ${requirements.posts} ${postsLabel}`);
                    if (!weekData.metLikes) missing.push(`Need ≥ ${requirements.likes} ${likesLabel}`);
                    message += missing.join('; ');
                    message += '\n';
                } else {
                    message += '**Requirements Met** ✅\n';
                }
                return message;
            };

            // --- Build and Send Embed ---
            const embed = new EmbedBuilder()
                .setTitle('📊 Your YouTube 3-Week Stats') // YouTube Title
                .setColor('#FF0000') // YouTube Red
                .setDescription(
                    `**Subscribers:** ${subscribersStr}\n\n` + // Use Subscribers
                    generateRequirementMessage('Week 1', week1) + '\n' +
                    generateRequirementMessage('Week 2', week2) + '\n' +
                    generateRequirementMessage('Week 3', week3)
                )
                .setTimestamp()
                .setFooter({ text: 'YouTube CC Requirements Check' }); // YouTube Footer

            await interaction.editReply({ embeds: [embed], ephemeral: false });
            console.log(`[${commandName}] Successfully sent stats embed to user ${userId}.`);

        } catch (error) {
            console.error(`[${commandName}] Error executing command for user ${interaction.user.tag}:`, error);
            // Generic error handling
            try {
                if (!interaction.replied && !interaction.deferred) {
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