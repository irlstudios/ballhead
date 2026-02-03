const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');
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
            await interaction.editReply({
                flags: MessageFlags.IsComponentsV2,
                components: [
                    new TextDisplayBuilder().setContent('## User Not Found'),
                    new TextDisplayBuilder().setContent('Could not find the specified member/user.')
                ],
                ephemeral: true
            });
            return;
        }
        const targetUser = invitedUser || invitedMember.user;
        const targetUserId = targetUser.id;
        const targetUserTag = targetUser.tag;

        if (targetUserId === commandUserID) {
            await interaction.editReply({
                flags: MessageFlags.IsComponentsV2,
                components: [new TextDisplayBuilder().setContent('You cannot invite yourself to your own squad.')],
                ephemeral: true
            });
            return;
        }
        if (targetUser.bot) {
            await interaction.editReply({
                flags: MessageFlags.IsComponentsV2,
                components: [new TextDisplayBuilder().setContent('You cannot invite bots to a squad.')],
                ephemeral: true
            });
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
                await interaction.editReply({
                    flags: MessageFlags.IsComponentsV2,
                    components: [new TextDisplayBuilder().setContent('You must be a squad leader to invite members.')],
                    ephemeral: true
                });
                return;
            }
            const squadName = inviterLeaderRow ? inviterLeaderRow[2]?.trim() : inviterAllDataRow[2]?.trim();
            const finalSquadType = inviterAllDataRow ? inviterAllDataRow[3]?.trim() : null;
            if (!squadName || squadName === 'N/A') {
                await interaction.editReply({
                    flags: MessageFlags.IsComponentsV2,
                    components: [new TextDisplayBuilder().setContent('Could not determine your squad name. Please contact an admin.')],
                    ephemeral: true
                });
                return;
            }
            if (!finalSquadType || finalSquadType === 'N/A') {
                await interaction.editReply({
                    flags: MessageFlags.IsComponentsV2,
                    components: [new TextDisplayBuilder().setContent('Could not determine your squad type. Please contact an admin.')],
                    ephemeral: true
                });
                return;
            }

            const membersInSquad = squadMembers.filter(row => row && row.length > 2 && row[2]?.trim() === squadName);
            const currentMemberCount = membersInSquad.length + 1;
            if (currentMemberCount >= MAX_SQUAD_MEMBERS) {
                await interaction.editReply({
                    flags: MessageFlags.IsComponentsV2,
                    components: [new TextDisplayBuilder().setContent(`Your squad **${squadName}** is full (${currentMemberCount}/${MAX_SQUAD_MEMBERS}).`)],
                    ephemeral: true
                });
                return;
            }

            const inviteeIsLeader = squadLeaders.find(row => row && row.length > 1 && row[1] === targetUserId);
            if (inviteeIsLeader) {
                await interaction.editReply({
                    flags: MessageFlags.IsComponentsV2,
                    components: [new TextDisplayBuilder().setContent(`<@${targetUserId}> is already a squad leader and cannot be invited.`)],
                    ephemeral: true
                });
                return;
            }

            const inviteeInSquad = squadMembers.find(row => row && row.length > 1 && row[1] === targetUserId);
            if (inviteeInSquad) {
                const existingSquad = inviteeInSquad[2] || 'another squad';
                await interaction.editReply({
                    flags: MessageFlags.IsComponentsV2,
                    components: [new TextDisplayBuilder().setContent(`<@${targetUserId}> is already in **${existingSquad}**.`)],
                    ephemeral: true
                });
                return;
            }

            const inviteeAllDataRow = allData.find(row => row && row.length > 1 && row[1] === targetUserId);
            if (inviteeAllDataRow && inviteeAllDataRow.length > 7 && inviteeAllDataRow[7] === 'FALSE') {
                await interaction.editReply({
                    flags: MessageFlags.IsComponentsV2,
                    components: [new TextDisplayBuilder().setContent(`<@${targetUserId}> has opted out of receiving squad invitations.`)],
                    ephemeral: true
                });
                return;
            }


            const now = new Date();
            const futureTime = new Date(now.getTime() + INVITE_EXPIRY_MS);
            const futureTimestamp = Math.floor(futureTime.getTime() / 1000);

            const inviteContainer = new ContainerBuilder()
                .setAccentColor(0x14B8A6)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`## You've Been Invited!`)
                )
                .addSeparatorComponents(
                    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
                )
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`**${squadName}** • ${finalSquadType}`),
                    new TextDisplayBuilder().setContent(`<@${commandUserID}> wants you to join their squad.`)
                )
                .addSeparatorComponents(
                    new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small)
                )
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`-# Expires <t:${futureTimestamp}:R>`)
                );

            let inviteMessage;
            try {
                inviteMessage = await targetUser.send({ flags: MessageFlags.IsComponentsV2, components: [inviteContainer] });

            } catch (dmError) {
                if (dmError.code === 50007) {
                    console.log(`Cannot send DM to ${targetUserTag} (${targetUserId}) - DMs likely disabled.`);
                    const dmFailedContainer = new ContainerBuilder()
                        .setAccentColor(0xF1C40F)
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`## Could Not Send Invite`),
                            new TextDisplayBuilder().setContent(`<@${targetUserId}> has DMs disabled or has blocked the bot.`),
                            new TextDisplayBuilder().setContent(`-# Ask them to enable DMs and try again`)
                        );
                    await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [dmFailedContainer], ephemeral: true });
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
                        const expiredContainer = new ContainerBuilder()
                            .setAccentColor(0x95A5A6)
                            .addTextDisplayComponents(
                                new TextDisplayBuilder().setContent(`## Invitation Expired`),
                                new TextDisplayBuilder().setContent(`The invite from <@${commandUserID}> to join **${squadName}** has expired.`),
                                new TextDisplayBuilder().setContent(`-# Ask them to send a new invite if you're still interested`)
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

            const successContainer = new ContainerBuilder()
                .setAccentColor(0x2ECC71)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`## Invite Sent`),
                    new TextDisplayBuilder().setContent(`<@${targetUserId}> has been invited to **${squadName}**.`),
                    new TextDisplayBuilder().setContent(`-# They have 48 hours to respond`)
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
            await interaction.editReply({
                flags: MessageFlags.IsComponentsV2,
                components: [new TextDisplayBuilder().setContent(`Something went wrong. Please try again later.`)],
                ephemeral: true
            }).catch(console.error);
        }
    }
};
