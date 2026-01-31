const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageFlags, ContainerBuilder, ChannelType, TextDisplayBuilder } = require('discord.js');
const { getSheetsClient } = require('../../utils/sheets_cache');

function buildTextBlock({ title, subtitle, lines } = {}) {
    const parts = [];
    if (title) {
        parts.push(`## ${title}`);
    }
    if (subtitle) {
        parts.push(subtitle);
    }
    if (Array.isArray(lines) && lines.length > 0) {
        if (parts.length > 0) {
            parts.push('');
        }
        parts.push(...lines.filter(Boolean));
    }
    if (parts.length === 0) {
        return null;
    }
    return new TextDisplayBuilder().setContent(parts.join('\n'));
}

const SPREADSHEET_ID = '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k';
const CHANNEL_ID = '1214781415670153266';
const LOGGING_CHANNEL_ID = '1233854185276051516';
const ERROR_LOGGING_CHANNEL_ID = '1233853458092658749';
const PRACTICE_DURATION_MS = 24 * 60 * 60 * 1000;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('squad-practice')
        .setDescription('Starts a private practice session thread for your squad.'),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const userId = interaction.user.id;
        const userTag = interaction.user.tag;

        const sheets = await getSheetsClient();

        let thread;

        try {
            const squadLeadersResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: 'Squad Leaders!A:F'
            });

            const squadLeadersData = squadLeadersResponse.data.values || [];
            const squadLeaders = squadLeadersData.slice(1);

            const userIsLeaderRow = squadLeaders.find(row => row && row.length > 1 && row[1] === userId);

            if (!userIsLeaderRow) {
                const errorContainer = new ContainerBuilder();
                const block = buildTextBlock({ title: 'Not a Squad Leader', subtitle: 'Practice Session', lines: ['You cannot start a practice session because you do not own a squad.'] });
            if (block) errorContainer.addTextDisplayComponents(block);
                return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer], ephemeral: true });
            }

            const squadName = userIsLeaderRow[2]?.trim();
            if (!squadName || squadName === 'N/A') {
                const errorContainer = new ContainerBuilder();
                const block = buildTextBlock({ title: 'Squad Name Missing', subtitle: 'Practice Session', lines: ['Could not determine your squad name from the sheet.', 'Please contact an admin.'] });
            if (block) errorContainer.addTextDisplayComponents(block);
                return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer], ephemeral: true });
            }

            const channel = await interaction.client.channels.fetch(CHANNEL_ID);
            if (!channel || channel.type !== ChannelType.GuildText) {
                console.error(`Practice channel ${CHANNEL_ID} not found or is not a text channel.`);
                const errorContainer = new ContainerBuilder();
                const block = buildTextBlock({ title: 'Channel Missing', subtitle: 'Practice Session', lines: ['Could not find the designated channel for practice sessions.'] });
            if (block) errorContainer.addTextDisplayComponents(block);
                return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer], ephemeral: true });
            }

            thread = await channel.threads.create({
                name: `${squadName} Practice Session`,
                autoArchiveDuration: 1440,
                type: ChannelType.PrivateThread,
                reason: `${userTag} started a practice session for squad ${squadName}`,
                invitable: false
            }).catch(err => {
                console.error(`Failed to create thread for ${squadName}: ${err.message}`);
                throw new Error('Failed to create the practice thread. Please check bot permissions.');
            });

            const threadContainer = new ContainerBuilder();
            const threadBlock = buildTextBlock({ title: `[${squadName}] Practice Session`, subtitle: 'Private Thread', lines: [
                `Welcome to the **[${squadName}]** practice thread, started by <@${interaction.user.id}>!`,
                'Use this space to coordinate activities and track progress. Good luck!',
                '*This thread will be automatically deleted after 24 hours.*'
            ] });
            if (threadBlock) threadContainer.addTextDisplayComponents(threadBlock);
            await thread.send({ flags: MessageFlags.IsComponentsV2, components: [threadContainer] });

            const squadMembersResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: 'Squad Members!A:E'
            });

            const squadMembersData = squadMembersResponse.data.values || [];
            const squadMembers = squadMembersData.slice(1);

            const squadMemberIds = squadMembers
                .filter(row => row && row.length > 2 && row[2]?.trim() === squadName)
                .map(row => row[1]?.trim())
                .filter(id => id);

            const allParticipantIds = [...new Set([userId, ...squadMemberIds])];

            const invitePromises = [];
            for (const memberId of squadMemberIds) {
                if (memberId !== userId) {
                    invitePromises.push(thread.members.add(memberId).catch(err => {
                        console.warn(`Could not add member ${memberId} to thread ${thread.id}: ${err.message}`);
                    }));
                }
            }
            await Promise.all(invitePromises);

            const dmPromises = [];
            for (const memberId of allParticipantIds) {
                const dmContainer = new ContainerBuilder();
                const block = buildTextBlock({ title: 'Squad Practice Session Started', subtitle: 'Private Thread', lines: [`A practice session for squad **${squadName}** has started in <#${thread.id}>.`, 'Join the thread for more details!'] });
            if (block) dmContainer.addTextDisplayComponents(block);

                dmPromises.push(
                    interaction.client.users.fetch(memberId).then(user => {
                        return user.send({ flags: MessageFlags.IsComponentsV2, components: [dmContainer] });
                    }).catch(error => {
                        console.log(`Could not send practice start DM to ${memberId}:`, error.message);
                    })
                );
            }
            await Promise.all(dmPromises);

            try {
                const loggingChannel = await interaction.client.channels.fetch(LOGGING_CHANNEL_ID);
                const logContainer = new ContainerBuilder();
                const block = buildTextBlock({ title: 'Squad Practice Session Started', subtitle: 'Logging', lines: [
                    `**Squad:** ${squadName}`,
                    `**Started by:** ${userTag} (<@${userId}>)`,
                    `**Thread:** <#${thread.id}>`
                ] });
            if (block) logContainer.addTextDisplayComponents(block);
                await loggingChannel.send({ flags: MessageFlags.IsComponentsV2, components: [logContainer] });
            } catch (logError) {
                console.error(`Failed to send practice start log message: ${logError.message}`);
            }

            setTimeout(async () => {
                try {
                    console.log(`Attempting to delete practice thread ${thread.id} for squad ${squadName}.`);
                    const fetchedThread = await channel.threads.fetch(thread.id).catch(() => null);
                    if (fetchedThread) {
                        await fetchedThread.delete(`Practice session ended after ${PRACTICE_DURATION_MS / (60*60*1000)} hours.`);
                    } else {
                        console.log(`Practice thread ${thread.id} already deleted or not found.`);
                    }

                    const endDmPromises = [];
                    for (const memberId of allParticipantIds) {
                        const notificationContainer = new ContainerBuilder();
                        const block = buildTextBlock({ title: 'Squad Practice Session Ended', subtitle: 'Thread Closed', lines: [`The practice session thread for squad **${squadName}** has ended and been deleted.`] });
            if (block) notificationContainer.addTextDisplayComponents(block);
                        endDmPromises.push(
                            interaction.client.users.fetch(memberId).then(user => {
                                return user.send({ flags: MessageFlags.IsComponentsV2, components: [notificationContainer] });
                            }).catch(error => {
                                console.log(`Could not send practice end DM to ${memberId}:`, error.message);
                            })
                        );
                    }
                    await Promise.all(endDmPromises);

                    try {
                        const loggingChannel = await interaction.client.channels.fetch(LOGGING_CHANNEL_ID);
                        const endLogContainer = new ContainerBuilder();
                        const block = buildTextBlock({ title: 'Squad Practice Session Ended', subtitle: 'Logging', lines: [`The practice session for squad **${squadName}** has concluded.`] });
            if (block) endLogContainer.addTextDisplayComponents(block);
                        await loggingChannel.send({ flags: MessageFlags.IsComponentsV2, components: [endLogContainer] });
                    } catch (logError) {
                        console.error(`Failed to send practice end log message: ${logError.message}`);
                    }

                } catch (error) {
                    console.error(`Error during scheduled thread deletion/notification for ${thread.id}:`, error.message);
                    try {
                        const errorLoggingChannel = await interaction.client.channels.fetch(ERROR_LOGGING_CHANNEL_ID);
                        const errorContainer = new ContainerBuilder();
                        const block = buildTextBlock({ title: 'Error During Practice Cleanup', subtitle: 'Automation Failure', lines: [`**Squad:** ${squadName}`, `**Thread ID:** ${thread.id}`, `**Error:** ${error.message}`] });
            if (block) errorContainer.addTextDisplayComponents(block);
                        await errorLoggingChannel.send({ flags: MessageFlags.IsComponentsV2, components: [errorContainer] });
                    } catch (logError) {
                        console.error('Failed to log cleanup error:', logError);
                    }
                }
            }, PRACTICE_DURATION_MS);

            const successContainer = new ContainerBuilder();
            const successBlock = buildTextBlock({ title: 'Practice Session Started', subtitle: 'Squad Practice', lines: [
                `Practice session for squad **${squadName}** started in <#${thread.id}>!`,
                'Members have been invited and notified.',
                'The thread will be deleted in 24 hours.'
            ] });
            if (successBlock) successContainer.addTextDisplayComponents(successBlock);
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [successContainer], ephemeral: true });

        } catch (error) {
            console.error(`Error during /squad-practice for ${userTag} (${userId}):`, error);

            if (thread) {
                try {
                    await thread.delete(`Error during setup: ${error.message}`);
                    console.log(`Cleaned up thread ${thread.id} due to error.`);
                } catch (cleanupError) {
                    console.error(`Failed to clean up thread ${thread.id} after error: ${cleanupError.message}`);
                }
            }

            try {
                const errorLoggingChannel = await interaction.client.channels.fetch(ERROR_LOGGING_CHANNEL_ID);
                const errorLogContainer = new ContainerBuilder();
                const block = buildTextBlock({ title: 'Squad Practice Command Error', subtitle: 'Command Failure', lines: [`**User:** ${userTag} (<@${userId}>)`, `**Error:** ${error.message}`] });
            if (block) errorLogContainer.addTextDisplayComponents(block);
                await errorLoggingChannel.send({ flags: MessageFlags.IsComponentsV2, components: [errorLogContainer] });
            } catch (logError) {
                console.error('Failed to log error to Discord:', logError);
            }

            if (!interaction.replied) {
                const replyContainer = new ContainerBuilder();
                const block = buildTextBlock({ title: 'Request Failed', subtitle: 'Squad Practice', lines: [`An error occurred: ${error.message || 'Please try again later.'}`] });
            if (block) replyContainer.addTextDisplayComponents(block);
                await interaction.editReply({
                    flags: MessageFlags.IsComponentsV2,
                    components: [replyContainer],
                    ephemeral: true
                }).catch(console.error);
            }
        }
    }
};
