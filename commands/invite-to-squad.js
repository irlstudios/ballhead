const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { google } = require('googleapis');
const axios = require('axios');
const credentials = require('../resources/secret.json');

const LOGGING_GUILD_ID = '1233740086839869501';
const LOGGING_CHANNEL_ID = '1233853415952748645';
const ERROR_LOG_CHANNEL_ID = '1233853458092658749';

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

module.exports = {
    data: new SlashCommandBuilder()
        .setName('invite-to-squad')
        .setDescription('Invite a member to your squad.')
        .addUserOption(option =>
            option.setName('member')
                .setDescription('The member you would like to invite to your squad!')
                .setRequired(true)
        ),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const commandUserID = interaction.user.id;
        const invitedMember = interaction.options.getUser('member');

        if (!invitedMember) {
            await interaction.editReply({ content: 'Could not find the specified user.', ephemeral: true });
            return;
        }

        const user = await interaction.client.users.fetch(invitedMember.id);
        if (!user) {
            await interaction.editReply({ content: 'Failed to fetch the user from Discord.', ephemeral: true });
            return;
        }

        const auth = authorize();

        const checkUserSquad = async (commandUserID) => {
            const sheets = google.sheets({ version: 'v4', auth });
            const spreadsheetId = '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k';
            const range = 'All Data!A:F';

            try {
                const response = await sheets.spreadsheets.values.get({
                    spreadsheetId: spreadsheetId,
                    range: range,
                });

                const allData = response.data.values;
                if (allData && allData.length) {
                    const userSquad = allData.find(row => row[1] === commandUserID);
                    if (!userSquad || userSquad[4] === 'No') {
                        await interaction.editReply({
                            content: "You don't own a squad, so you can't invite someone.",
                            ephemeral: true
                        });
                        return null;
                    }
                    const squadName = userSquad[2];
                    const squadType = userSquad[3];
                    return { squadName, squadType };
                } else {
                    console.log('No data found in All Data.');
                    return null;
                }
            } catch (error) {
                console.error('Error checking user squad:', error);
                return null;
            }
        };

        const checkInvitedMemberPref = async (invitedMemberID) => {
            const sheets = google.sheets({ version: 'v4', auth });
            const spreadsheetId = '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k';
            const range = 'All Data!A:F';

            try {
                const response = await sheets.spreadsheets.values.get({
                    spreadsheetId: spreadsheetId,
                    range: range,
                });

                const allData = response.data.values;
                if (allData && allData.length) {
                    const invitedMember = allData.find(row => row[1] === invitedMemberID);
                    if (invitedMember && invitedMember[5] === 'FALSE') {
                        await interaction.editReply({
                            content: "The invited member has opted out of squad invitations.",
                            ephemeral: true
                        });
                        return false;
                    }
                    return true;
                } else {
                    console.log('No data found in All Data.');
                    return false;
                }
            } catch (error) {
                console.error('Error checking invited member preference:', error);
                return false;
            }
        };

        const checkInvitedMemberSquad = async (invitedMemberID) => {
            const sheets = google.sheets({ version: 'v4', auth });
            const spreadsheetId = '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k';
            const range = 'Squad Members!A:C';

            try {
                const response = await sheets.spreadsheets.values.get({
                    spreadsheetId: spreadsheetId,
                    range: range,
                });

                const squadMembers = response.data.values;
                if (squadMembers && squadMembers.length) {
                    const invitedMemberSquad = squadMembers.find(row => row[1] === invitedMemberID);
                    if (invitedMemberSquad) {
                        await interaction.editReply({
                            content: "The invited member is already in a squad.",
                            ephemeral: true
                        });
                        return false;
                    }
                    return true;
                } else {
                    console.log('No data found in Squad Members.');
                    return false;
                }
            } catch (error) {
                console.error('Error checking invited member squad:', error);
                return false;
            }
        };

        const checkIfSquadLeader = async (invitedMemberID) => {
            const sheets = google.sheets({ version: 'v4', auth });
            const spreadsheetId = '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k';
            const range = 'Squad Leaders!A:C';

            try {
                const response = await sheets.spreadsheets.values.get({
                    spreadsheetId: spreadsheetId,
                    range: range,
                });

                const squadMembers = response.data.values;
                if (squadMembers && squadMembers.length) {
                    const invitedMemberSquad = squadMembers.find(row => row[1] === invitedMemberID);
                    if (invitedMemberSquad) {
                        await interaction.editReply({
                            content: "The invited member is already in a squad.",
                            ephemeral: true
                        });
                        return false;
                    }
                    return true;
                } else {
                    console.log('No data found in Squad Members.');
                    return false;
                }
            } catch (error) {
                console.error('Error checking invited member squad:', error);
                return false;
            }
        };

        const checkSquadMemberCount = async (squadName) => {
            const sheets = google.sheets({ version: 'v4', auth });
            const spreadsheetId = '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k';
            const range = 'Squad Members!A:C';

            try {
                const response = await sheets.spreadsheets.values.get({
                    spreadsheetId: spreadsheetId,
                    range: range,
                });

                const squadMembers = response.data.values;
                if (squadMembers && squadMembers.length) {
                    const dataRows = squadMembers.slice(1);
                    const membersInSquad = dataRows.filter(row => row[2] === squadName);
                    return membersInSquad.length;
                } else {
                    console.log('No data found in Squad Members.');
                    return 0;
                }
            } catch (error) {
                console.error('Error checking squad member count:', error);
                return 0;
            }
        };

        try {
            const userSquad = await checkUserSquad(commandUserID);
            if (!userSquad) return;

            const { squadName, squadType } = userSquad;

            const squadMemberCount = await checkSquadMemberCount(squadName);
            if (squadMemberCount >= 9) {
                await interaction.editReply({
                    content: `Your squad **[${squadName}]** already has 10 members. You cannot invite more members.`,
                    ephemeral: true
                });
                return;
            }

            const invitedMemberPref = await checkInvitedMemberPref(invitedMember.id);
            if (!invitedMemberPref) return;

            const invitedMemberSquad = await checkInvitedMemberSquad(invitedMember.id);
            if (!invitedMemberSquad) return;

            const checkInvitedMemberLeagueOwner = await checkIfSquadLeader(invitedMember.id);
            if (!checkInvitedMemberLeagueOwner) return;

            if (!squadType) {
                await interaction.editReply({ content: 'Squad type is missing for your squad. Cannot proceed with the invite.', ephemeral: true });
                return;
            }

            const now = new Date();
            const futureTime = new Date(now.getTime() + 48 * 60 * 60 * 1000);
            const futureTimestamp = Math.floor(futureTime.getTime() / 1000);

            const inviteEmbed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('Squad Invitation')
                .setDescription(`Hello <@${user.id}>,\n\nYou have been invited to join **[${squadName}]**! If you'd like to join this squad, use the Accept Invite button below!\n\nThis invite will expire <t:${futureTimestamp}:R> if no response`)
                .setFooter({ text: 'Ballhead Squad System' });

            const message = await user.send({ embeds: [inviteEmbed] });

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`invite_accept_${message.id}`)
                        .setLabel('Accept Invite')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`invite_reject_${message.id}`)
                        .setLabel('Reject Invite')
                        .setStyle(ButtonStyle.Danger),
                );

            await message.edit({ components: [row] });

            const loggingGuild = interaction.client.guilds.cache.get(LOGGING_GUILD_ID);
            if (!loggingGuild) {
                await interaction.editReply({ content: 'Logging guild not found.', ephemeral: true });
                return;
            }
            const trackingChannel = loggingGuild.channels.cache.get(LOGGING_CHANNEL_ID);
            if (!trackingChannel) {
                await interaction.editReply({ content: 'Tracking channel not found.', ephemeral: true });
                return;
            }
            const trackingMessage = await trackingChannel.send(`**${commandUserID}** has invited **${invitedMember.id}** to their squad --> **[${squadName}]**`);

            const postData = {
                command_user_id: commandUserID,
                invited_member_id: invitedMember.id,
                squad_name: squadName,
                message_id: message.id,
                tracking_message_id: trackingMessage.id,
                squad_type: squadType
            };

            await axios.post('http://localhost:3000/api/invite', postData);

            await interaction.editReply({ content: `You have invited <@${user.id}> to your squad!`, ephemeral: true });
            setTimeout(async () => {
                try {
                    const response = await axios.get(`http://localhost:3000/api/invite/${message.id}`);
                    const inviteData = response.data;

                    if (inviteData.invite_status && inviteData.invite_status.toLowerCase().trim() === 'pending') {
                        await message.edit({
                            content: '**This invite has expired**',
                            components: [],
                        });

                        if (trackingMessage) {
                            await trackingMessage.edit(`The invite from **${commandUserID}** to **${invitedMember.id}** to join their squad --> **[${squadName}]** has expired 😵`);
                        }

                        await axios.delete(`http://localhost:3000/api/invite/${message.id}`);
                    }
                } catch (error) {
                    console.error('Error during the auto-archive process:', error);
                }
            }, 48 * 60 * 60 * 1000);

        } catch (error) {
            console.error('Error during the command execution:', error);

            try {
                const errorGuild = await interaction.client.guilds.fetch(LOGGING_GUILD_ID);
                const errorChannel = await errorGuild.channels.fetch(ERROR_LOG_CHANNEL_ID);
                const errorEmbed = new EmbedBuilder()
                    .setTitle('Error')
                    .setDescription(`An error occurred while executing the command: ${error.message}`)
                    .setColor('#FF0000');

                await errorChannel.send({ embeds: [errorEmbed] });
            } catch (logError) {
                console.error('Failed to log error:', logError);
            }

            await interaction.editReply({
                content: 'An error occurred while processing your request. Please try again later.',
                ephemeral: true
            });
        }
    }
};
