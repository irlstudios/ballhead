const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { google } = require('googleapis');
const credentials = require('../resources/secret.json');
const { Pool } = require('pg'); // Import the pg Pool

// --- Load Environment Variables (Ensure dotenv is configured in entry point) ---
// require('dotenv').config(); // Usually done in index.js

// --- Constants ---
const SPREADSHEET_ID = '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k';
const REQUIRED_ROLE_ID = '924522770057031740';
const APPLICATION_CHANNEL_ID = '1218466649695457331';
const LOGGING_GUILD_ID = '1233740086839869501';
const ERROR_LOGGING_CHANNEL_ID = '1233853458092658749';

// --- Authorization Function (Google Sheets) ---
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

// --- Create PostgreSQL Connection Pool ---
const pool = new Pool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    database: process.env.DB_DATABASE_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT || 5432,
    ssl: { rejectUnauthorized: false },
});

pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('❌ PostgreSQL Pool Error: Failed to connect.', err.stack);
    } else {
        console.log('✅ PostgreSQL Pool Connected.');
    }
});

module.exports = {
    cooldown: 604800,
    data: new SlashCommandBuilder()
        .setName('register')
        .setDescription('Apply to register a new Squad.')
        .addStringOption(option =>
            option.setName('squadname')
                .setDescription('The desired name/tag for your Squad (1-4 alphanumeric chars).')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('squadtype')
                .setDescription('Select the intended type for your Squad.')
                .setRequired(true)
                .addChoices(
                    { name: 'Casual', value: 'Casual' },
                    { name: 'Competitive', value: 'Competitive' },
                    { name: 'Content', value: 'Content' }
                )),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        // --- Initial Checks ---
        const hasRequiredRole = interaction.member.roles.cache.has(REQUIRED_ROLE_ID);
        if (!hasRequiredRole) { /* ... role check reply ... */
            return interaction.editReply({ content: `You must have the <@&${REQUIRED_ROLE_ID}> role to register a squad!`, ephemeral: true });
        }

        const squadName = interaction.options.getString('squadname').toUpperCase();
        const squadType = interaction.options.getString('squadtype');
        const userId = interaction.user.id;
        const username = interaction.user.username;
        const userTag = interaction.user.tag;

        if (!/^[A-Z0-9]{1,4}$/.test(squadName)) { /* ... format check reply ... */
            return interaction.editReply({ content: 'Squad names must be 1 to 4 letters (A-Z) or numbers (0-9).', ephemeral: true });
        }

        const gAuth = authorize(); // Google Auth Client
        const sheets = google.sheets({ version: 'v4', auth: gAuth });

        let applicationMessage; // Define higher for potential cleanup

        try {
            // --- Fetch Sheet Data ---
            const [allDataResponse, squadLeadersResponse, applicationsResponse] = await Promise.all([
                sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'All Data!A:H' }),
                sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Squad Leaders!A:F' }),
                sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Applications!A:F' })
            ]).catch(err => { /* ... handle sheet fetch error ... */
                console.error("Error fetching sheet data:", err); throw new Error("Failed to retrieve necessary data from Google Sheets.");
            });

            const allData = (allDataResponse.data.values || []).slice(1);
            const squadLeaders = (squadLeadersResponse.data.values || []).slice(1);
            const applications = (applicationsResponse.data.values || []).slice(1);

            // --- Perform User/Squad Checks ---
            const userInAllData = allData.find(row => row && row.length > 1 && row[1] === userId);
            const userInSquadLeaders = squadLeaders.find(row => row && row.length > 1 && row[1] === userId);
            const squadNameTaken = squadLeaders.find(row => row && row.length > 2 && row[2]?.toUpperCase() === squadName);
            const isMarkedLeaderInAllData = userInAllData && userInAllData.length > 6 && userInAllData[6] === 'Yes';
            if (userInSquadLeaders || isMarkedLeaderInAllData) { /* ... already owner reply ... */
                return interaction.editReply({ content: 'You appear to already own a squad.', ephemeral: true });
            }
            if (userInAllData && userInAllData.length > 2 && userInAllData[2] !== 'N/A' && userInAllData[2]?.toUpperCase() !== squadName) { /* ... already in squad reply ... */
                return interaction.editReply({ content: `You are already listed as a member of squad **${userInAllData[2]}**.`, ephemeral: true });
            }
            if (squadNameTaken) { /* ... name taken reply ... */
                return interaction.editReply({ content: `The squad tag **${squadName}** is already taken.`, ephemeral: true });
            }
            const existingPendingApp = applications.find(row => row && row.length > 5 && row[1] === userId && row[5] === 'Pending');
            if (existingPendingApp) { /* ... pending app reply ... */
                return interaction.editReply({ content: 'You already have a pending squad application.', ephemeral: true });
            }

            // --- Submit Application (Discord Part) ---
            const applicationEmbed = new EmbedBuilder() /* ... embed ... */
                .setColor('#FFA500').setTitle('New Squad Application')
                .addFields( { name: 'Applicant', value: `${userTag} (<@${userId}>)`, inline: false }, { name: 'Requested Squad Name', value: squadName, inline: true }, { name: 'Requested Squad Type', value: squadType, inline: true } )
                .setFooter({text: `Interaction ID: ${interaction.id}`}).setTimestamp();
            const actionRow = new ActionRowBuilder() /* ... buttons ... */
                .addComponents( new ButtonBuilder().setCustomId(`application_accept_${interaction.id}`).setLabel('Accept').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`application_deny_${interaction.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger) );
            const channel = await interaction.client.channels.fetch(APPLICATION_CHANNEL_ID).catch(err => { /* ... handle channel fetch error ... */
                console.error(`Failed to fetch application channel ${APPLICATION_CHANNEL_ID}: ${err.message}`); throw new Error('Could not find the application channel.');
            });
            applicationMessage = await channel.send({ embeds: [applicationEmbed], components: [actionRow] }).catch(err => { /* ... handle message send error ... */
                console.error(`Failed to send application message to channel ${APPLICATION_CHANNEL_ID}: ${err.message}`); throw new Error('Failed to send the application message.');
            });


            // --- Insert into PostgreSQL Database ---
            const tableName = 'squad_applications_data'; // Assumed table name - REPLACE IF NEEDED
            const dbClient = await pool.connect();
            try {
                // *** UPDATED Column Names (Removed status, created_at) ***
                const columns = [
                    'member_display_name',
                    'member_object',
                    'member_squad_name',
                    'message_url',
                    'user_id',
                    'squad_type'
                    // Removed 'status', 'created_at'
                ];

                // Prepare Data Object for 'member_object' column
                const memberInfoObject = {
                    id: userId,
                    username: username,
                    tag: userTag,
                    avatar: interaction.user.displayAvatarURL()
                };

                // *** UPDATED Values Array (Removed 'Pending', new Date()) ***
                const values = [
                    interaction.member.displayName,     // member_display_name
                    JSON.stringify(memberInfoObject),   // member_object (stringified JSON)
                    squadName,                          // member_squad_name
                    applicationMessage.url,             // message_url
                    userId,                             // user_id (Discord ID as string)
                    squadType                           // squad_type
                    // Removed 'Pending', new Date()
                ];

                // Prepare Query String (uses updated columns/values count)
                const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
                const insertQuery = `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders}) RETURNING *;`;


                console.log(`Attempting to insert application into PostgreSQL table ${tableName} for interaction ${interaction.id}`);
                // console.log(`Query: ${insertQuery}`); // Optional debug log
                // console.log(`Values: ${JSON.stringify(values)}`); // Optional debug log

                // Execute Query
                const result = await dbClient.query(insertQuery, values);
                console.log('✅ Application data successfully inserted into PostgreSQL:', result.rows?.[0] || 'No rows returned.');

            } catch (dbError) {
                console.error(`❌ Failed to insert application data into PostgreSQL table ${tableName}:`, dbError);
                applicationMessage.delete().catch(delErr => console.error(`Failed to delete application msg ${applicationMessage.id} after DB error: ${delErr.message}`));
                throw new Error('Failed to record the application in the database.');
            } finally {
                dbClient.release(); // Release client back to pool
            }
            // *** END OF DATABASE INSERT BLOCK ***


            // --- Append to Applications Sheet ---
            await sheets.spreadsheets.values.append({
                spreadsheetId: SPREADSHEET_ID,
                range: 'Applications!A1',
                valueInputOption: 'RAW',
                resource: { values: [[username, userId, squadName, squadType, applicationMessage.url, 'Pending']] } // Sheet still includes 'Pending' status
            }).catch(err => { /* ... handle sheet append error ... */
                console.error(`Failed to append application to sheet after DB insert: ${err.message}`);
            });

            // --- Confirm Submission to User ---
            await interaction.editReply({
                content: `Your application to register squad **${squadName}** (${squadType}) has been submitted for review.`,
                ephemeral: true
            });

        } catch (error) {
            console.error(`Error processing /register command for ${userTag} (${userId}):`, error);
            // Log error to specific channel
            try {
                const errorGuild = await interaction.client.guilds.fetch(LOGGING_GUILD_ID);
                const errorChannel = await errorGuild.channels.fetch(ERROR_LOGGING_CHANNEL_ID);
                const errorEmbed = new EmbedBuilder() /* ... error log embed ... */
                    .setTitle('Squad Registration Command Error')
                    .setDescription(`**User:** ${userTag} (${userId})\n**Error:** ${error.message}`)
                    .setColor('#FF0000')
                    .setTimestamp();
                await errorChannel.send({ embeds: [errorEmbed] });
            } catch (logError) {
                console.error('Failed to log registration error to Discord:', logError);
            }
            // Reply to user about the error
            await interaction.editReply({
                content: `An error occurred while submitting your application: ${error.message || 'Please try again later or contact an admin.'}`,
                ephemeral: true
            }).catch(console.error);
        }
    }
};