const {SlashCommandBuilder} = require('@discordjs/builders');
const {google} = require('googleapis');
const {EmbedBuilder, ChannelType} = require('discord.js');
const credentials = require('../resources/secret.json');

const CHANNEL_ID = '1214781415670153266';
const LOGGING_CHANNEL_ID = '1233854185276051516';
const ERROR_LOGGING_CHANNEL_ID = '1233853458092658749';

function authorize() {
    const {client_email, private_key} = credentials;
    const auth = new google.auth.JWT(
        client_email,
        null,
        private_key,
        ['https://www.googleapis.com/auth/spreadsheets']
    );
    return auth;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('squad-practice')
        .setDescription('Start a practice session with your squad'),

    async execute(interaction) {
        const userId = interaction.user.id;
        const username = interaction.user.username;

        const auth = authorize();
        const sheets = google.sheets({version: 'v4', auth});

        try {
            const squadLeadersResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k',
                range: 'Squad Leaders!A:C'
            });

            const squadLeaders = squadLeadersResponse.data.values;
            const userIsLeader = squadLeaders.find(row => row[1] === userId);

            if (!userIsLeader) {
                return interaction.reply({
                    content: 'You cannot use this command because you do not own a squad.',
                    ephemeral: true
                });
            }

            const squadName = userIsLeader[2];

            const channel = await interaction.client.channels.fetch(CHANNEL_ID);
            if (!channel) {
                return interaction.reply({content: 'Channel not found.', ephemeral: true});
            }

            const thread = await channel.threads.create({
                name: `${squadName} Practice Session`,
                autoArchiveDuration: 1440,
                type: ChannelType.PrivateThread,
                reason: `${squadName} Practice session`,
            });

            const embed = new EmbedBuilder()
                .setTitle(`${squadName} Practice Session`)
                .setDescription(`Welcome to the **[${squadName}]** Practice Thread \n \n The squad practice session thread has been created by <@${interaction.user.id}> Everyone can keep track of the squad's activities and coordinate the gameplay here 🎮👍! \n \n  *This thread will be deactivated after 24hs* `)
                .setColor('#00FF00');

            const message = await thread.send({embeds: [embed]});

            const squadMembersResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k',
                range: 'Squad Members!A:C'
            });

            const squadMembers = squadMembersResponse.data.values.filter(row => row[2] === squadName);
            const squadMemberIds = squadMembers.map(row => row[1]);

            const squadMemberIdsIncludingLeader = [userId, ...squadMemberIds];

            const pings = squadMemberIdsIncludingLeader.map(id => `<@${id}>`).join(' ');
            const pingMessage = await thread.send(pings);

            await pingMessage.delete();

            for (const memberId of squadMemberIdsIncludingLeader) {
                try {
                    const memberUser = await interaction.client.users.fetch(memberId);
                    const dmEmbed = new EmbedBuilder()
                        .setTitle('Squad Practice Session Started')
                        .setDescription(`A practice session for squad ${squadName} has started. Join the thread for more details.`)
                        .setColor('#00FF00');
                    await memberUser.send({embeds: [dmEmbed]});
                } catch (error) {
                    console.log(`Could not send DM to ${memberId}:`, error.message);
                }
            }

            const loggingChannel = await interaction.client.channels.fetch(LOGGING_CHANNEL_ID);
            const logEmbed = new EmbedBuilder()
                .setTitle('Squad Practice Session Started')
                .setDescription(`A practice session for squad ${squadName} has started by ${username}.`)
                .setColor('#00FF00');

            await loggingChannel.send({embeds: [logEmbed]});

            setTimeout(async () => {
                try {
                    await thread.delete();

                    const notificationEmbed = new EmbedBuilder()
                        .setTitle('Squad Practice Session Ended')
                        .setDescription(`The practice session for squad ${squadName} has ended.`)
                        .setColor('#FF0000');

                    for (const memberId of squadMemberIdsIncludingLeader) {
                        try {
                            const memberUser = await interaction.client.users.fetch(memberId);
                            await memberUser.send({embeds: [notificationEmbed]});
                        } catch (error) {
                            console.log(`Could not send DM to ${memberId}:`, error.message);
                        }
                    }

                    const endLogEmbed = new EmbedBuilder()
                        .setTitle('Squad Practice Session Ended')
                        .setDescription(`The practice session for squad ${squadName} has ended.`)
                        .setColor('#FF0000');

                    await loggingChannel.send({embeds: [endLogEmbed]});

                } catch (error) {
                    console.log(`Could not delete thread or send notifications:`, error.message);
                }
            }, 24 * 60 * 60 * 1000);

            await interaction.reply({
                content: `Practice session for squad ${squadName} has started. Check the thread for details.`,
                ephemeral: true
            });
        } catch (error) {
            console.error(error);
            try {
                const errorLoggingChannel = await interaction.client.channels.fetch(ERROR_LOGGING_CHANNEL_ID);
                const errorEmbed = new EmbedBuilder()
                    .setTitle('Error')
                    .setDescription(`An error occurred while processing the \`squad-practice\` command: ${error.message}`)
                    .setColor('#FF0000')
                    .setTimestamp();
                await errorLoggingChannel.send({embeds: [errorEmbed]});
            } catch (logError) {
                console.error('Failed to log error:', logError);
            }

            if (!interaction.replied) {
                await interaction.reply({
                    content: 'An error occurred while processing your request.',
                    ephemeral: true
                }).catch(console.error);
            }
        }
    }
};
