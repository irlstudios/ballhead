const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const credentials = require('../resources/secret.json');

// --- Constants ---
const SHEET_ID = '1nO8wK4p27DgbOHQhuFrYfg1y78AvjYmw7yGYato1aus';
const TAB_NAME = 'Playoffs Conf';
const ROUND_CELL = 'B2';
const FULL_RANGE = `'${TAB_NAME}'!${ROUND_CELL}`;

// Permissions (Adjust roles as needed)
const MODERATOR_ROLES = ['805833778064130104', '909227142808756264']; // Example Moderator Roles

// Logging constants (optional)
const LOGGING_GUILD_ID = '1233740086839869501'; // Example
const LOGGING_CHANNEL_ID = '1233853415952748645'; // Example action log
const ERROR_LOGGING_CHANNEL_ID = '1233853458092658749'; // Example error log

// --- Authorization Function ---
function authorize() {
    const { client_email, private_key } = credentials;
    const auth = new google.auth.JWT(
        client_email,
        null,
        private_key,
        ['https://www.googleapis.com/auth/spreadsheets'] // Read/Write needed
    );
    return auth;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('increment-round')
        .setDescription('Increments the current event round number (Moderators only).'),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const moderatorUserId = interaction.user.id;
        const moderatorUserTag = interaction.user.tag;
        const guild = interaction.guild;

        if (!guild) {
            return interaction.editReply({ content: 'This command must be run in a server.', ephemeral: true });
        }

        // --- Permission Check ---
        const member = await guild.members.fetch(moderatorUserId).catch(() => null);
        if (!member) {
            return interaction.editReply({ content: 'Could not verify your membership.', ephemeral: true });
        }
        const isMod = MODERATOR_ROLES.some(roleId => member.roles.cache.has(roleId));
        if (!isMod) {
            return interaction.editReply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }

        const auth = authorize();
        const sheets = google.sheets({ version: 'v4', auth });

        try {
            // --- Read Current Round ---
            let currentRound = 0; // Default if cell is empty or invalid
            try {
                const response = await sheets.spreadsheets.values.get({
                    spreadsheetId: SHEET_ID,
                    range: FULL_RANGE,
                });

                // Check if value exists and parse it
                if (response.data.values && response.data.values[0] && response.data.values[0][0]) {
                    const rawValue = response.data.values[0][0];
                    const parsedValue = parseInt(rawValue, 10);
                    if (!isNaN(parsedValue)) {
                        currentRound = parsedValue;
                    } else {
                        console.warn(`Value in ${FULL_RANGE} ('${rawValue}') is not a valid number. Defaulting to 0.`);
                        // Optionally throw an error instead: throw new Error(`Invalid value found in round cell ${FULL_RANGE}.`);
                    }
                } else {
                    console.log(`Cell ${FULL_RANGE} is empty. Defaulting to round 0.`);
                }
            } catch (err) {
                // Handle case where the sheet or tab might not exist yet for the GET call
                if (err.code === 400 && err.message.includes('Unable to parse range')) {
                    console.log(`Range ${FULL_RANGE} not found. Assuming round 0.`);
                    currentRound = 0; // Default if range doesn't exist
                } else {
                    console.error(`Error reading current round from ${FULL_RANGE}:`, err);
                    throw new Error("Failed to read the current round number from the sheet.");
                }
            }

            // --- Increment Round ---
            const newRound = currentRound + 1;
            console.log(`Incrementing round from ${currentRound} to ${newRound}`);

            // --- Write New Round ---
            await sheets.spreadsheets.values.update({
                spreadsheetId: SHEET_ID,
                range: FULL_RANGE,
                valueInputOption: 'RAW', // Use RAW for simple number
                resource: {
                    values: [[newRound]] // Value must be in a 2D array
                }
            }).catch(err => {
                console.error(`Error writing new round ${newRound} to ${FULL_RANGE}:`, err);
                throw new Error("Failed to update the round number in the sheet.");
            });

            // --- Log Action (Optional) ---
            try {
                const loggingGuild = await interaction.client.guilds.fetch(LOGGING_GUILD_ID);
                const loggingChannel = await loggingGuild.channels.fetch(LOGGING_CHANNEL_ID);
                const logEmbed = new EmbedBuilder()
                    .setTitle('Event Round Incremented')
                    .setDescription(`Moderator **${moderatorUserTag}** (<@${moderatorUserId}>) incremented the event round.`)
                    .addFields({ name: 'New Round', value: newRound.toString(), inline: true })
                    .setColor('#FFA500') // Orange/Yellow
                    .setTimestamp();
                await loggingChannel.send({ embeds: [logEmbed] });
            } catch (logError) {
                console.error('Failed to send round increment log message:', logError);
            }

            // --- Success Reply ---
            const successEmbed = new EmbedBuilder()
                .setColor('#00FF00') // Green
                .setTitle('Event Round Incremented')
                .setDescription(`The event round has been successfully incremented to **Round ${newRound}**.`)
                .setTimestamp();

            await interaction.editReply({ embeds: [successEmbed], ephemeral: true });

        } catch (error) {
            console.error(`Error processing /increment-round by ${moderatorUserTag}:`, error);
            // Log detailed error
            try {
                const errorGuild = await interaction.client.guilds.fetch(LOGGING_GUILD_ID);
                const errorChannel = await errorGuild.channels.fetch(ERROR_LOGGING_CHANNEL_ID);
                const errorEmbed = new EmbedBuilder()
                    .setTitle('Increment Round Command Error')
                    .setDescription(`**User:** ${moderatorUserTag} (${moderatorUserId})\n**Error:** ${error.message}`)
                    .setColor('#FF0000') // Red
                    .setTimestamp();
                await errorChannel.send({ embeds: [errorEmbed] });
            } catch (logError) {
                console.error('Failed to log increment round command error:', logError);
            }
            // Reply to user
            await interaction.editReply({
                content: `An error occurred: ${error.message || 'Could not update the round number.'}`,
                ephemeral: true
            }).catch(console.error);
        }
    }
};