const { SlashCommandBuilder } = require('@discordjs/builders'); // Using builders is fine
const { google } = require('googleapis');
const { EmbedBuilder, ChannelType } = require('discord.js');
// const axios = require('axios'); // Unused import removed in previous versions
const credentials = require('../resources/secret.json');

// --- Constants ---
const SPREADSHEET_ID = '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k';
const CHANNEL_ID = '1214781415670153266'; // Target channel for threads
const LOGGING_CHANNEL_ID = '1233854185276051516'; // Practice session logs
const ERROR_LOGGING_CHANNEL_ID = '1233853458092658749'; // Command error logs
const PRACTICE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// --- Authorization function ---
function authorize() {
    const { client_email, private_key } = credentials;
    const auth = new google.auth.JWT(
        client_email,
        null,
        private_key,
        // Scope needs read/write for sheets if future versions modify, but readonly might suffice if only reading. Keep read/write for safety.
        ['https://www.googleapis.com/auth/spreadsheets']
    );
    return auth;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('squad-practice')
        .setDescription('Starts a private practice session thread for your squad.'), // Slightly improved description

    async execute(interaction) {
        // Defer reply immediately
        await interaction.deferReply({ ephemeral: true });

        const userId = interaction.user.id;
        const userTag = interaction.user.tag; // Use tag for logging

        const auth = authorize();
        const sheets = google.sheets({ version: 'v4', auth });

        let thread; // Define thread variable in the outer scope for cleanup on error

        try {
            // --- Get Squad Leader Info ---
            const squadLeadersResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                // *** UPDATED RANGE ***
                range: 'Squad Leaders!A:F' // Read full new range
            });

            // Handle potential empty sheet/response
            const squadLeadersData = squadLeadersResponse.data.values || [];
            const squadLeaders = squadLeadersData.slice(1); // Skip header row

            // Find leader row (ID is column B, index 1)
            const userIsLeaderRow = squadLeaders.find(row => row && row.length > 1 && row[1] === userId);

            if (!userIsLeaderRow) {
                return interaction.editReply({
                    content: 'You cannot start a practice session because you do not own a squad.',
                    ephemeral: true
                });
            }

            // Get squad name (Column C, index 2)
            const squadName = userIsLeaderRow[2]?.trim();
            if (!squadName || squadName === 'N/A') {
                return interaction.editReply({
                    content: 'Could not determine your squad name from the sheet. Please contact an admin.',
                    ephemeral: true
                });
            }

            // --- Create Thread ---
            const channel = await interaction.client.channels.fetch(CHANNEL_ID);
            if (!channel || channel.type !== ChannelType.GuildText) { // Ensure it's a text channel
                console.error(`Practice channel ${CHANNEL_ID} not found or is not a text channel.`);
                return interaction.editReply({ content: 'Could not find the designated channel for practice sessions.', ephemeral: true });
            }

            thread = await channel.threads.create({
                name: `${squadName} Practice Session`,
                autoArchiveDuration: 1440, // 24 hours
                type: ChannelType.PrivateThread, // Keep it private
                reason: `${userTag} started a practice session for squad ${squadName}`,
                invitable: false // Depending on your preference, usually false for private threads
            }).catch(err => {
                console.error(`Failed to create thread for ${squadName}: ${err.message}`);
                throw new Error('Failed to create the practice thread. Please check bot permissions.'); // Throw specific error
            });

            // Send initial embed to thread
            const embed = new EmbedBuilder()
                .setTitle(`[${squadName}] Practice Session`)
                .setDescription(`Welcome to the **[${squadName}]** practice thread, started by <@${interaction.user.id}>!\n\nUse this space to coordinate activities and track progress. Good luck! 🎮👍\n\n*This thread will be automatically deleted after 24 hours.*`)
                .setColor('#00FF00') // Green
                .setTimestamp();
            await thread.send({ embeds: [embed] });

            // --- Get Squad Members ---
            const squadMembersResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                // *** UPDATED RANGE ***
                range: 'Squad Members!A:E' // Read full new range
            });

            const squadMembersData = squadMembersResponse.data.values || [];
            const squadMembers = squadMembersData.slice(1); // Skip header

            // Filter members by squad name (Column C, index 2) and get IDs (Column B, index 1)
            const squadMemberIds = squadMembers
                .filter(row => row && row.length > 2 && row[2]?.trim() === squadName)
                .map(row => row[1]?.trim())
                .filter(id => id); // Filter out any empty IDs

            // Combine leader and member IDs, ensure no duplicates
            const allParticipantIds = [...new Set([userId, ...squadMemberIds])];

            // --- Invite members and Ping (Optional Ping) ---
            const invitePromises = [];
            // Add leader first (thread creator is automatically added)
            // Add members
            for (const memberId of squadMemberIds) { // Only explicitly add members, not leader
                if (memberId !== userId) { // Don't try to add the creator
                    invitePromises.push(thread.members.add(memberId).catch(err => {
                        console.warn(`Could not add member ${memberId} to thread ${thread.id}: ${err.message}`);
                        // Don't fail the whole command, just log the warning
                    }));
                }
            }
            await Promise.all(invitePromises); // Wait for invites to attempt


            // Send pings in the thread (then delete) - Optional, can be noisy
            // const pings = allParticipantIds.map(id => `<@${id}>`).join(' ');
            // try {
            //     const pingMessage = await thread.send(pings);
            //     await pingMessage.delete();
            // } catch (pingError) {
            //     console.warn(`Failed to send/delete pings in thread ${thread.id}: ${pingError.message}`);
            // }


            // --- Send DMs ---
            const dmPromises = [];
            for (const memberId of allParticipantIds) {
                const dmEmbed = new EmbedBuilder()
                    .setTitle('Squad Practice Session Started')
                    .setDescription(`A practice session for squad **${squadName}** has started in <#${thread.id}>. Join the thread for more details!`)
                    .setColor('#00FF00') // Green
                    .setTimestamp();

                dmPromises.push(
                    interaction.client.users.fetch(memberId).then(user => {
                        return user.send({ embeds: [dmEmbed] });
                    }).catch(error => {
                        // Log DM failure but continue
                        console.log(`Could not send practice start DM to ${memberId}:`, error.message);
                    })
                );
            }
            await Promise.all(dmPromises); // Send DMs concurrently


            // --- Log Action ---
            try {
                const loggingChannel = await interaction.client.channels.fetch(LOGGING_CHANNEL_ID);
                const logEmbed = new EmbedBuilder()
                    .setTitle('Squad Practice Session Started')
                    .setDescription(`Squad: **${squadName}**\nStarted by: ${userTag} (<@${userId}>)\nThread: <#${thread.id}>`)
                    .setColor('#00FF00') // Green
                    .setTimestamp();
                await loggingChannel.send({ embeds: [logEmbed] });
            } catch (logError) {
                console.error(`Failed to send practice start log message: ${logError.message}`);
                // Don't fail command, just log error
            }

            // --- Schedule Thread Deletion and End Notifications ---
            setTimeout(async () => {
                try {
                    console.log(`Attempting to delete practice thread ${thread.id} for squad ${squadName}.`);
                    // Fetch thread again to ensure it exists before deleting
                    const fetchedThread = await channel.threads.fetch(thread.id).catch(() => null);
                    if (fetchedThread) {
                        await fetchedThread.delete(`Practice session ended after ${PRACTICE_DURATION_MS / (60*60*1000)} hours.`);
                    } else {
                        console.log(`Practice thread ${thread.id} already deleted or not found.`);
                    }

                    // Send end notifications via DM
                    const notificationEmbed = new EmbedBuilder()
                        .setTitle('Squad Practice Session Ended')
                        .setDescription(`The practice session thread for squad **${squadName}** has ended and been deleted.`)
                        .setColor('#FF0000') // Red
                        .setTimestamp();

                    const endDmPromises = [];
                    for (const memberId of allParticipantIds) {
                        endDmPromises.push(
                            interaction.client.users.fetch(memberId).then(user => {
                                return user.send({ embeds: [notificationEmbed] });
                            }).catch(error => {
                                console.log(`Could not send practice end DM to ${memberId}:`, error.message);
                            })
                        );
                    }
                    await Promise.all(endDmPromises);

                    // Log session end
                    try {
                        const loggingChannel = await interaction.client.channels.fetch(LOGGING_CHANNEL_ID);
                        const endLogEmbed = new EmbedBuilder()
                            .setTitle('Squad Practice Session Ended')
                            .setDescription(`The practice session for squad **${squadName}** has concluded.`)
                            .setColor('#FF0000') // Red
                            .setTimestamp();
                        await loggingChannel.send({ embeds: [endLogEmbed] });
                    } catch (logError) {
                        console.error(`Failed to send practice end log message: ${logError.message}`);
                    }

                } catch (error) {
                    console.error(`Error during scheduled thread deletion/notification for ${thread.id}:`, error.message);
                    // Log error, but can't easily notify user here
                    try {
                        const errorLoggingChannel = await interaction.client.channels.fetch(ERROR_LOGGING_CHANNEL_ID);
                        const errorEmbed = new EmbedBuilder()
                            .setTitle('Error During Practice Cleanup')
                            .setDescription(`**Squad:** ${squadName}\n**Thread ID:** ${thread.id}\n**Error:** ${error.message}`)
                            .setColor('#FFCC00') // Yellow/Orange for cleanup error
                            .setTimestamp();
                        await errorLoggingChannel.send({ embeds: [errorEmbed] });
                    } catch (logError) {
                        console.error('Failed to log cleanup error:', logError);
                    }
                }
            }, PRACTICE_DURATION_MS); // Use constant for duration

            // --- Success Reply to User ---
            await interaction.editReply({
                content: `Practice session for squad **${squadName}** started in <#${thread.id}>! Members have been invited and notified. The thread will be deleted in 24 hours.`,
                ephemeral: true
            });

        } catch (error) {
            console.error(`Error during /squad-practice for ${userTag} (${userId}):`, error);

            // Attempt to clean up thread if created before error
            if (thread) {
                try {
                    await thread.delete(`Error during setup: ${error.message}`);
                    console.log(`Cleaned up thread ${thread.id} due to error.`);
                } catch (cleanupError) {
                    console.error(`Failed to clean up thread ${thread.id} after error: ${cleanupError.message}`);
                }
            }

            // Log error to specific channel
            try {
                const errorLoggingChannel = await interaction.client.channels.fetch(ERROR_LOGGING_CHANNEL_ID);
                const errorEmbed = new EmbedBuilder()
                    .setTitle('Squad Practice Command Error')
                    .setDescription(`**User:** ${userTag} (<@${userId}>)\n**Error:** ${error.message}`)
                    .setColor('#FF0000') // Red
                    .setTimestamp();
                await errorLoggingChannel.send({ embeds: [errorEmbed] });
            } catch (logError) {
                console.error('Failed to log error to Discord:', logError);
            }

            // Reply to user about the error (if not already replied)
            if (!interaction.replied) {
                await interaction.editReply({
                    content: `An error occurred: ${error.message || 'Please try again later.'}`,
                    ephemeral: true
                }).catch(console.error);
            }
        }
    }
};