const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const { insertInvite, fetchInviteById, deleteInvite } = require('../../db');
const { getSheetsClient } = require('../../utils/sheets_cache');

const SPREADSHEET_ID = '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k';
const LOGGING_GUILD_ID = '1233740086839869501';
const LOGGING_CHANNEL_ID = '1233853415952748645';
const ERROR_LOG_CHANNEL_ID = '1233853458092658749';
const MAX_SQUAD_MEMBERS = 10;
const INVITE_EXPIRY_MS = 48 * 60 * 60 * 1000;

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
            const container = new ContainerBuilder();
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent('## User Not Found'),
                new TextDisplayBuilder().setContent('Could not find the specified member/user.')
            );
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true });
            return;
        }
        const targetUser = invitedUser || invitedMember.user;
        const targetUserId = targetUser.id;
        const targetUserTag = targetUser.tag;

        if (targetUserId === commandUserID) {
            const container = new ContainerBuilder();
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent('## Invalid Target'),
                new TextDisplayBuilder().setContent('You cannot invite yourself to your own squad.')
            );
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true });
            return;
        }
        if (targetUser.bot) {
            const container = new ContainerBuilder();
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent('## Invalid Target'),
                new TextDisplayBuilder().setContent('You cannot invite bots to a squad.')
            );
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true });
            return;
        }

        const sheets = await getSheetsClient();

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
                const container = new ContainerBuilder();
                container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('## Access Denied'),
                    new TextDisplayBuilder().setContent('You must be a squad leader to invite members.')
                );
                await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true });
                return;
            }
            const squadName = inviterLeaderRow ? inviterLeaderRow[2]?.trim() : inviterAllDataRow[2]?.trim();
            const finalSquadType = inviterAllDataRow ? inviterAllDataRow[3]?.trim() : null;
            if (!squadName || squadName === 'N/A') {
                const container = new ContainerBuilder();
                container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('## Squad Name Missing'),
                    new TextDisplayBuilder().setContent('Could not determine your squad name.')
                );
                await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true });
                return;
            }
            if (!finalSquadType || finalSquadType === 'N/A') {
                const container = new ContainerBuilder();
                container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('## Squad Type Missing'),
                    new TextDisplayBuilder().setContent('Could not determine your squad type.')
                );
                await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true });
                return;
            }

            const membersInSquad = squadMembers.filter(row => row && row.length > 2 && row[2]?.trim() === squadName);
            const currentMemberCount = membersInSquad.length + 1;
            if (currentMemberCount >= MAX_SQUAD_MEMBERS) {
                const container = new ContainerBuilder();
                container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('## Squad Full'),
                    new TextDisplayBuilder().setContent(`Your squad **${squadName}** is full (${currentMemberCount}/${MAX_SQUAD_MEMBERS}).`)
                );
                await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true });
                return;
            }

            const inviteeIsLeader = squadLeaders.find(row => row && row.length > 1 && row[1] === targetUserId);
            if (inviteeIsLeader) {
                const container = new ContainerBuilder();
                container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('## Invite Not Allowed'),
                    new TextDisplayBuilder().setContent(`<@${targetUserId}> is already a squad leader.`)
                );
                await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true });
                return;
            }

            const inviteeInSquad = squadMembers.find(row => row && row.length > 1 && row[1] === targetUserId);
            if (inviteeInSquad) {
                const existingSquad = inviteeInSquad[2] || 'another squad';
                const container = new ContainerBuilder();
                container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('## Invite Not Allowed'),
                    new TextDisplayBuilder().setContent(`<@${targetUserId}> is already in **${existingSquad}**.`)
                );
                await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true });
                return;
            }

            const inviteeAllDataRow = allData.find(row => row && row.length > 1 && row[1] === targetUserId);
            if (inviteeAllDataRow && inviteeAllDataRow.length > 7 && inviteeAllDataRow[7] === 'FALSE') {
                const container = new ContainerBuilder();
                container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('## Invite Not Allowed'),
                    new TextDisplayBuilder().setContent(`<@${targetUserId}> has opted out of receiving squad invitations.`)
                );
                await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true });
                return;
            }


            const now = new Date();
            const futureTime = new Date(now.getTime() + INVITE_EXPIRY_MS);
            const futureTimestamp = Math.floor(futureTime.getTime() / 1000);

            const inviteContainer = new ContainerBuilder();
            inviteContainer.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`## Squad Invitation\n${squadName}`),
                new TextDisplayBuilder().setContent([
                    `Hello <@${targetUserId}>`,
                    `<@${commandUserID}> has invited you to join **${squadName}** (${finalSquadType}).`,
                    `**Expires:** <t:${futureTimestamp}:R>`,
                    'Use the buttons below to respond.'
                ].join('\n'))
            );

            let inviteMessage;
            try {
                inviteMessage = await targetUser.send({ flags: MessageFlags.IsComponentsV2, components: [inviteContainer] });

            } catch (dmError) {
                if (dmError.code === 50007) {
                    console.log(`Cannot send DM to ${targetUserTag} (${targetUserId}) - DMs likely disabled.`);
                    const container = new ContainerBuilder();
                    container.addTextDisplayComponents(
                        new TextDisplayBuilder().setContent('## DM Failed'),
                        new TextDisplayBuilder().setContent(`Could not send an invite DM to <@${targetUserId}>.\nThey might have DMs disabled or have blocked the bot.`)
                    );
                    await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true });
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
            await inviteMessage.edit({ flags: MessageFlags.IsComponentsV2, components: [inviteContainer, row] }).catch(editErr => {
                console.error(`Failed to add buttons to invite DM ${inviteMessage.id}: ${editErr.message}`);
            });

            let trackingMessage;
            try {
                const loggingGuild = await interaction.client.guilds.fetch(LOGGING_GUILD_ID);
                const trackingChannel = await loggingGuild.channels.fetch(LOGGING_CHANNEL_ID);
                const trackingContainer = new ContainerBuilder();
                trackingContainer.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('## Invite Sent'),
                    new TextDisplayBuilder().setContent(`**${commandUserTag}** (<@${commandUserID}>) invited **${targetUserTag}** (<@${targetUserId}>) to squad **${squadName}**.`)
                );
                trackingMessage = await trackingChannel.send({ flags: MessageFlags.IsComponentsV2, components: [trackingContainer] });
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
                        const expiredContainer = new ContainerBuilder();
                        expiredContainer.addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`## Squad Invitation Expired\n${squadName}`),
                            new TextDisplayBuilder().setContent([
                                `Hello <@${targetUserId}>`,
                                `The invite from <@${commandUserID}> to join **${squadName}** has expired.`
                            ].join('\n'))
                        );
                        await inviteMessage.edit({ flags: MessageFlags.IsComponentsV2, components: [expiredContainer] }).catch(editErr => console.warn(`Could not edit expired invite DM ${inviteMessage.id}: ${editErr.message}`));
                        if (trackingMessage) {
                            const expiredTracking = new ContainerBuilder();
                            expiredTracking.addTextDisplayComponents(
                                new TextDisplayBuilder().setContent('## Invite Expired'),
                                new TextDisplayBuilder().setContent(`Invite from **${commandUserTag}** (<@${commandUserID}>) to **${targetUserTag}** (<@${targetUserId}>) for squad **${squadName}**.`)
                            );
                            await trackingMessage.edit({ flags: MessageFlags.IsComponentsV2, components: [expiredTracking] }).catch(editErr => console.warn(`Could not edit expired tracking message ${trackingMessage.id}: ${editErr.message}`));
                        }
                        await deleteInvite(inviteMessage.id);
                    }
                } catch (error) {
                    if (error.message && error.message.includes('404')) { console.log(`Invite ${inviteMessage.id} likely already processed or deleted before expiry.`); }
                    else { console.error(`Error during invite expiry check for ${inviteMessage.id}:`, error.message); }
                }
            }, INVITE_EXPIRY_MS);

            const successContainer = new ContainerBuilder();
            successContainer.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`## Invite Sent\n${squadName}`),
                new TextDisplayBuilder().setContent(`Invite successfully sent to <@${targetUserId}> for squad **${squadName}**.`)
            );
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [successContainer], ephemeral: true });

        } catch (error) {
            console.error(`Error during /invite-to-squad for ${commandUserTag}:`, error);
            try {
                const errorGuild = await interaction.client.guilds.fetch(LOGGING_GUILD_ID);
                const errorChannel = await errorGuild.channels.fetch(ERROR_LOG_CHANNEL_ID);
                const errorContainer = new ContainerBuilder();
                errorContainer.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`## Invite Command Error\n${squadName}`),
                    new TextDisplayBuilder().setContent([
                        `**User:** ${commandUserTag} (${commandUserID})`,
                        `**Invitee:** ${targetUserTag} (${targetUserId})`,
                        `**Error:** ${error.message}`
                    ].join('\n'))
                );
                await errorChannel.send({ flags: MessageFlags.IsComponentsV2, components: [errorContainer] });
            } catch (logError) { console.error('Failed to log invite command error:', logError); }
            const replyContainer = new ContainerBuilder();
            replyContainer.addTextDisplayComponents(
                new TextDisplayBuilder().setContent('## Request Failed'),
                new TextDisplayBuilder().setContent(`An error occurred: ${error.message || 'Please try again later.'}`)
            );
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [replyContainer], ephemeral: true }).catch(console.error);
        }
    }
};
