const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { google } = require('googleapis');
const { insertInvite, fetchInviteById, deleteInvite } = require('../../db');
const credentials = require('../../resources/secret.json');

const SPREADSHEET_ID = '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k';
const LOGGING_GUILD_ID = '1233740086839869501';
const LOGGING_CHANNEL_ID = '1233853415952748645';
const ERROR_LOG_CHANNEL_ID = '1233853458092658749';
const MAX_SQUAD_MEMBERS = 10;
const INVITE_EXPIRY_MS = 48 * 60 * 60 * 1000;

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
        .setDescription('Invite a member to join your squad (Squad Leaders only).')
        .addUserOption(option =>
            option.setName('member')
                .setDescription('The member you want to invite.')
                .setRequired(true)
        ),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const commandUserID = interaction.user.id;
        const commandUserTag = interaction.user.tag;
        const invitedMember = interaction.options.getMember('member');
        const invitedUser = interaction.options.getUser('member');

        if (!invitedMember && !invitedUser) {
            await interaction.editReply({ content: 'Could not find the specified member/user.', ephemeral: true });
            return;
        }
        const targetUser = invitedUser || invitedMember.user;
        const targetUserId = targetUser.id;
        const targetUserTag = targetUser.tag;

        if (targetUserId === commandUserID) {
            await interaction.editReply({ content: 'You cannot invite yourself to your own squad.', ephemeral: true });
            return;
        }
        if (targetUser.bot) {
            await interaction.editReply({ content: 'You cannot invite bots to a squad.', ephemeral: true });
            return;
        }

        const auth = authorize();
        const sheets = google.sheets({ version: 'v4', auth });

        try {
            const [allDataResponse, squadMembersResponse, squadLeadersResponse] = await Promise.all([
                sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'All Data!A:H' }),
                sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Squad Members!A:E' }),
                sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Squad Leaders!A:F' }),
            ]).catch(err => {
                console.error('Error fetching sheet data:', err);
                throw new Error('Failed to retrieve necessary data from Google Sheets.');
            });

            const allData = (allDataResponse.data.values || []).slice(1);
            const squadMembers = (squadMembersResponse.data.values || []).slice(1);
            const squadLeaders = (squadLeadersResponse.data.values || []).slice(1);

            const inviterLeaderRow = squadLeaders.find(row => row && row.length > 1 && row[1] === commandUserID);
            const inviterAllDataRow = allData.find(row => row && row.length > 1 && row[1] === commandUserID);
            const isInviterMarkedLeader = inviterAllDataRow && inviterAllDataRow.length > 6 && inviterAllDataRow[6] === 'Yes';
            if (!inviterLeaderRow && !isInviterMarkedLeader) {
                await interaction.editReply({ content: 'You must be a squad leader to invite members.', ephemeral: true });
                return;
            }
            const squadName = inviterLeaderRow ? inviterLeaderRow[2]?.trim() : inviterAllDataRow[2]?.trim();
            const finalSquadType = inviterAllDataRow ? inviterAllDataRow[3]?.trim() : null;
            if (!squadName || squadName === 'N/A') {
                await interaction.editReply({ content: 'Could not determine your squad name.', ephemeral: true }); return;
            }
            if (!finalSquadType || finalSquadType === 'N/A') {
                await interaction.editReply({ content: 'Could not determine your squad type.', ephemeral: true }); return;
            }

            const membersInSquad = squadMembers.filter(row => row && row.length > 2 && row[2]?.trim() === squadName);
            const currentMemberCount = membersInSquad.length + 1;
            if (currentMemberCount >= MAX_SQUAD_MEMBERS) {
                await interaction.editReply({ content: `Your squad **${squadName}** is full (${currentMemberCount}/${MAX_SQUAD_MEMBERS}).`, ephemeral: true });
                return;
            }

            const inviteeIsLeader = squadLeaders.find(row => row && row.length > 1 && row[1] === targetUserId);
            if (inviteeIsLeader) {
                await interaction.editReply({ content: `<@${targetUserId}> is already a squad leader.`, ephemeral: true });
                return;
            }

            const inviteeInSquad = squadMembers.find(row => row && row.length > 1 && row[1] === targetUserId);
            if (inviteeInSquad) {
                const existingSquad = inviteeInSquad[2] || 'another squad';
                await interaction.editReply({ content: `<@${targetUserId}> is already in **${existingSquad}**.`, ephemeral: true });
                return;
            }

            const inviteeAllDataRow = allData.find(row => row && row.length > 1 && row[1] === targetUserId);
            if (inviteeAllDataRow && inviteeAllDataRow.length > 7 && inviteeAllDataRow[7] === 'FALSE') {
                await interaction.editReply({ content: `<@${targetUserId}> has opted out of receiving squad invitations.`, ephemeral: true });
                return;
            }


            const now = new Date();
            const futureTime = new Date(now.getTime() + INVITE_EXPIRY_MS);
            const futureTimestamp = Math.floor(futureTime.getTime() / 1000);

            const inviteEmbed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('Squad Invitation')
                .setDescription(`Hello <@${targetUserId}>,\n\n<@${commandUserID}> has invited you to join their squad: **${squadName}** (${finalSquadType})!\n\nUse the buttons below to respond.`)
                .addFields({ name: 'Expires', value: `<t:${futureTimestamp}:R>` })
                .setFooter({ text: 'Ballhead Squad System' });

            let inviteMessage;
            try {
                inviteMessage = await targetUser.send({ embeds: [inviteEmbed] });

            } catch (dmError) {
                if (dmError.code === 50007) {
                    console.log(`Cannot send DM to ${targetUserTag} (${targetUserId}) - DMs likely disabled.`);
                    await interaction.editReply({
                        content: `❌ Could not send an invite DM to <@${targetUserId}>. They might have DMs disabled or have blocked the bot.`,
                        ephemeral: true
                    });
                } else {
                    console.error(`Failed to send invite DM to ${targetUserId}:`, dmError);
                    throw new Error('Failed to send the invite DM due to an unexpected error.');
                }
                return;
            }

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId(`invite_accept_${inviteMessage.id}`).setLabel('Accept Invite').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`invite_reject_${inviteMessage.id}`).setLabel('Reject Invite').setStyle(ButtonStyle.Danger),
                );
            await inviteMessage.edit({ components: [row] }).catch(editErr => {
                console.error(`Failed to add buttons to invite DM ${inviteMessage.id}: ${editErr.message}`);
            });

            let trackingMessage;
            try {
                const loggingGuild = await interaction.client.guilds.fetch(LOGGING_GUILD_ID);
                const trackingChannel = await loggingGuild.channels.fetch(LOGGING_CHANNEL_ID);
                trackingMessage = await trackingChannel.send(
                    `📤 Invite Sent: **${commandUserTag}** (<@${commandUserID}>) invited **${targetUserTag}** (<@${targetUserId}>) to squad **${squadName}**.`
                );
            } catch (logError) {
                console.error(`Failed to send invite log message: ${logError.message}`);
            }

            try {
                const postData = {
                    command_user_id: commandUserID,
                    invited_member_id: targetUserId,
                    squad_name: squadName,
                    message_id: inviteMessage.id,
                    tracking_message_id: trackingMessage ? trackingMessage.id : null,
                    squad_type: finalSquadType,
                    invite_status: 'Pending'
                };
                await insertInvite(postData.command_user_id, postData.invited_member_id, postData.squad_name, postData.message_id, postData.tracking_message_id, postData.squad_type);
                console.log(`Posted invite data for DM ${inviteMessage.id}`);
            } catch (apiError) {
                console.error(`Failed to post invite data: ${apiError.message}`);
            }

            setTimeout(async () => {
                try {
                    const currentInviteData = await fetchInviteById(inviteMessage.id);
                    if (currentInviteData && currentInviteData.invite_status === 'Pending') {
                        console.log(`Invite ${inviteMessage.id} expired.`);
                        const expiredEmbed = new EmbedBuilder(inviteMessage.embeds[0]?.data || {}) /* ... modify embed ... */
                            .setDescription(`Hello <@${targetUserId}>,\n\nThe invite from <@${commandUserID}> to join **${squadName}** has expired.`)
                            .setColor('#808080');
                        await inviteMessage.edit({ content: '**This invite has expired.**', embeds: [expiredEmbed], components: [], }).catch(editErr => console.warn(`Could not edit expired invite DM ${inviteMessage.id}: ${editErr.message}`));
                        if (trackingMessage) {
                            await trackingMessage.edit(`❌ Invite Expired: Invite from **${commandUserTag}** (<@${commandUserID}>) to **${targetUserTag}** (<@${targetUserId}>) for squad **${squadName}**.`).catch(editErr => console.warn(`Could not edit expired tracking message ${trackingMessage.id}: ${editErr.message}`));
                        }
                        await deleteInvite(inviteMessage.id);
                    }
                } catch (error) {
                    if (error.message && error.message.includes('404')) { console.log(`Invite ${inviteMessage.id} likely already processed or deleted before expiry.`); }
                    else { console.error(`Error during invite expiry check for ${inviteMessage.id}:`, error.message); }
                }
            }, INVITE_EXPIRY_MS);

            await interaction.editReply({ content: `✅ Invite successfully sent to <@${targetUserId}> for squad **${squadName}**!`, ephemeral: true });

        } catch (error) {
            console.error(`Error during /invite-to-squad for ${commandUserTag}:`, error);
            try {
                const errorGuild = await interaction.client.guilds.fetch(LOGGING_GUILD_ID);
                const errorChannel = await errorGuild.channels.fetch(ERROR_LOG_CHANNEL_ID);
                const errorEmbed = new EmbedBuilder()
                    .setTitle('Invite Command Error')
                    .setDescription(`**User:** ${commandUserTag} (${commandUserID})\n**Invitee:** ${targetUserTag} (${targetUserId})\n**Error:** ${error.message}`)
                    .setColor('#FF0000')
                    .setTimestamp();
                await errorChannel.send({ embeds: [errorEmbed] });
            } catch (logError) { console.error('Failed to log invite command error:', logError); }
            await interaction.editReply({
                content: `An error occurred: ${error.message || 'Please try again later.'}`,
                ephemeral: true
            }).catch(console.error);
        }
    }
};
